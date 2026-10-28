import { NodeServices } from "@effect/platform-node";
import { Tool } from "@opencode/schema/tool";
import { DateTime, Duration, Effect, FileSystem, Layer, Option, Predicate, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** Whether a tool only reads state or changes something. */
export type CliToolAccess = "read" | "write";

/** The command line and stdin for one tool call. */
export interface CliInvocation {
  readonly args: readonly string[];
  readonly stdin?: string;
}

/** Tool input as JSON, before each tool decodes it with its own schema. */
export const CliInput = Schema.Record(Schema.String, Schema.Json);

/** Tool input as JSON, before each tool decodes it with its own schema. */
export type CliInput = typeof CliInput.Type;

/** One CLI command exposed as a Code Mode tool. */
export interface CliTool {
  readonly name: string;
  readonly description: string;
  readonly access: CliToolAccess;
  readonly pinned: boolean;
  readonly timeout: Duration.Input;
  /** True when stdout is JSON to decode into the tool output. */
  readonly json: boolean;
  readonly input: Tool.ValueSchema;
  readonly invocation: (input: CliInput) => Effect.Effect<CliInvocation, Tool.Error>;
}

/** Define a tool whose input is an Effect Schema, decoded before building its command line. */
export const defineCliTool = <S extends Schema.Codec<any, any>>(tool: {
  readonly name: string;
  readonly description: string;
  readonly access: CliToolAccess;
  readonly pinned?: boolean;
  readonly timeout?: Duration.Input;
  readonly json: boolean;
  readonly input: S;
  readonly invocation: (input: S["Type"]) => CliInvocation;
}): CliTool => ({
  ...tool,
  pinned: tool.pinned ?? false,
  timeout: tool.timeout ?? "2 minutes",
  invocation: (input) =>
    Schema.decodeUnknownEffect(tool.input)(input).pipe(
      Effect.map(tool.invocation),
      Effect.mapError(
        (error) => new Tool.Error({ message: `Invalid input for ${tool.name}: ${error.message}` }),
      ),
    ),
});

/** Add a boolean flag when it is set. */
export const switchFlag = (name: string, value: boolean | undefined): readonly string[] =>
  value ? [`--${name}`] : [];

/** Add a value flag when it is set. */
export const valueFlag = (name: string, value: string | undefined): readonly string[] =>
  value === undefined ? [] : [`--${name}`, value];

/** What a client tool call does, prepared before the permission check. */
export interface ClientCall {
  /** The call as the permission prompt shows it. */
  readonly summary: string;
  /** A pattern appended to the tool id as the permission resource, so "always allow" covers calls of the same shape. */
  readonly resource?: string;
  /** This call's access, when the tool's depends on its input, such as an API method. */
  readonly access?: CliToolAccess;
  readonly run: Effect.Effect<unknown, Tool.Error>;
}

/** Where a client tool is called from. */
export interface ClientContext {
  /** The session's directory. */
  readonly directory: string;
}

/** One Effect client operation exposed as a Code Mode tool. */
export interface ClientTool {
  readonly name: string;
  readonly description: string;
  readonly access: CliToolAccess;
  readonly pinned: boolean;
  readonly timeout: Duration.Input;
  readonly input: Tool.ValueSchema;
  /** Whether to register the tool, when it depends on more than its namespace being available. */
  readonly available?: Effect.Effect<boolean>;
  readonly prepare: (input: CliInput, context: ClientContext) => Effect.Effect<ClientCall, Tool.Error>;
}

const WithMessage = Schema.Struct({ message: Schema.NonEmptyString });

/** Map any client failure to a `Tool.Error` carrying its message. */
export const toToolError = (cause: unknown) =>
  cause instanceof Tool.Error
    ? cause
    : new Tool.Error({
        message: Option.match(Schema.decodeUnknownOption(WithMessage)(cause), {
          onNone: () => String(cause),
          onSome: ({ message }) => message,
        }),
        error: cause,
      });

/**
 * Turn a client result into plain JSON for the tool output: options become their value or
 * null, and dates and date-times ISO strings, so decoded models read the way their wire format does.
 * Client results are already decoded by their own schemas; this only reshapes them for output.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns
export const plain = (value: unknown): unknown => {
  if (Option.isOption(value)) return Option.isSome(value) ? plain(value.value) : null;

  if (value instanceof Date) return value.toISOString();

  if (DateTime.isDateTime(value)) return DateTime.formatIso(value);

  if (Predicate.isBigInt(value)) return value.toString();

  if (Array.isArray(value)) return value.map(plain);

  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [String(key), plain(item)]));

  if (Predicate.isObject(value)) {
    const entries = Object.entries(value).filter(([key]) => !key.startsWith("~"));

    return Object.fromEntries(entries.map(([key, item]) => [key, plain(item)]));
  }

  return value;
};

/**
 * Bind client tool definitions to the layer that provides their client. Each call builds the
 * layer, so connections live only as long as the call.
 */
export const clientTools =
  <R, LE>(layer: Layer.Layer<R, LE>) =>
  <S extends Schema.Codec<any, any>, A, E>(tool: {
    readonly name: string;
    readonly description: string;
    readonly access: CliToolAccess;
    readonly pinned?: boolean;
    readonly timeout?: Duration.Input;
    readonly input: S;
    /** Whether to register the tool, when it depends on more than its namespace being available. */
    readonly available?: Effect.Effect<boolean>;
    /** A pattern narrowing the permission resource below the tool id. */
    readonly resource?: (input: S["Type"]) => string;
    /** The call as the permission prompt shows it; the tool name and input when unset. */
    readonly summary?: (input: S["Type"]) => string;
    readonly run: (input: S["Type"], context: ClientContext) => Effect.Effect<A, E, R>;
  }): ClientTool => ({
    name: tool.name,
    description: tool.description,
    access: tool.access,
    pinned: tool.pinned ?? false,
    timeout: tool.timeout ?? "2 minutes",
    input: tool.input,
    available: tool.available,
    prepare: (input, context) =>
      Schema.decodeUnknownEffect(tool.input)(input).pipe(
        Effect.mapError(
          (error) => new Tool.Error({ message: `Invalid input for ${tool.name}: ${error.message}` }),
        ),
        Effect.map((decoded) => ({
          summary: tool.summary?.(decoded) ?? `${tool.name} ${JSON.stringify(input)}`,
          resource: tool.resource?.(decoded),
          run: tool.run(decoded, context).pipe(
            Effect.map(plain),
            Effect.provide(layer),
            Effect.mapError(toToolError),
            Effect.timeoutOrElse({
              duration: tool.timeout ?? "2 minutes",
              orElse: () =>
                Effect.fail(new Tool.Error({ message: `${tool.name} timed out` })),
            }),
          ),
        })),
      ),
  });

/** CLI commands exposed as Code Mode tools, available when the command is on the PATH. */
export interface CliNamespace {
  readonly kind: "cli";
  readonly command: string;
  readonly description: string;
  readonly tools: readonly CliTool[];
}

/** Effect client operations exposed as Code Mode tools. */
export interface ClientNamespace {
  readonly kind: "client";
  /** The namespace name, also the prefix of its permission. */
  readonly command: string;
  readonly description: string;
  /** Whether the client can reach its service, checked once when the tools load. */
  readonly available: Effect.Effect<boolean>;
  readonly tools: readonly ClientTool[];
}

/** One Code Mode namespace. */
export type Namespace = CliNamespace | ClientNamespace;

/** Whether a file or socket exists, for checking a client's service is set up. */
export const pathExists = (path: string) =>
  Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) => fs.exists(path)).pipe(
    Effect.provide(NodeServices.layer),
    Effect.orElseSucceed(() => false),
  );

/** Whether a command is on the PATH, for namespaces that run CLIs through `runCliOutput`. */
export const commandExists = (command: string) => Effect.sync(() => Bun.which(command) !== null);

/** Run a CLI from a client tool, failing on a non-zero exit, and return stdout without its trailing newline. */
export const runCliText = (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly stdin?: string; readonly timeout?: Duration.Input } = {},
) =>
  runCli(command, args, { ...options, timeout: options.timeout ?? "2 minutes" }).pipe(
    Effect.flatMap((run) =>
      run.exitCode === 0
        ? Effect.succeed(run.stdout.trimEnd())
        : Effect.fail(
            new Tool.Error({
              message: `${[command, ...args].join(" ")} exited ${run.exitCode}\n${tailLines(run.stderr || run.stdout)}`,
              metadata: { exitCode: run.exitCode },
            }),
          ),
    ),
  );

/** Run a CLI from a client tool, failing on a non-zero exit, and decode stdout as JSON when `json` is set. */
export const runCliOutput = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly stdin?: string;
    readonly timeout?: Duration.Input;
    readonly json?: boolean;
  } = {},
) =>
  runCliText(command, args, options).pipe(
    Effect.flatMap((stdout) => {
      if (!options.json) return Effect.succeed<unknown>(stdout);

      return Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(stdout).pipe(
        Effect.mapError(
          (error) =>
            new Tool.Error({ message: `${[command, ...args].join(" ")} did not print JSON: ${error.message}` }),
        ),
      );
    }),
  );

/** The last lines of a command's output, for error messages. */
export const tailLines = (text: string) => text.trim().split("\n").slice(-20).join("\n");

/** The output of one finished CLI run. */
export interface CliRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Run a CLI to completion, capturing stdout and stderr, and kill it on timeout. */
export const runCli = (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly stdin?: string; readonly timeout: Duration.Input },
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const proc = yield* spawner.spawn(
      ChildProcess.make(command, args, {
        cwd: options.cwd,
        env: { NO_COLOR: "1" },
        extendEnv: true,
        stdin:
          options.stdin === undefined
            ? "ignore"
            : Stream.make(options.stdin).pipe(Stream.encodeText),
        stdout: "pipe",
        stderr: "pipe",
      }),
    );

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        proc.stdout.pipe(Stream.decodeText(), Stream.mkString),
        proc.stderr.pipe(Stream.decodeText(), Stream.mkString),
        proc.exitCode,
      ],
      { concurrency: "unbounded" },
    );

    return { stdout, stderr, exitCode: Number(exitCode) } satisfies CliRun;
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: options.timeout,
      orElse: () =>
        Effect.fail(
          new Tool.Error({
            message: `${command} ${args.join(" ")} timed out after ${Duration.format(Duration.fromInputUnsafe(options.timeout))}`,
          }),
        ),
    }),
    Effect.provide(NodeServices.layer),
    Effect.mapError((error) =>
      error instanceof Tool.Error
        ? error
        : new Tool.Error({ message: `Could not run ${command}: ${String(error)}`, error }),
    ),
  );
