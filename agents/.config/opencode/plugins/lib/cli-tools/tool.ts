import { NodeServices } from "@effect/platform-node";
import { Tool } from "@opencode/schema/tool";
import { Duration, Effect, Schema, Stream } from "effect";
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
