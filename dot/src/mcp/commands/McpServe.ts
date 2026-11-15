/**
 * @file Serve the agent tools from `dot agent tools` over MCP on stdio. Each
 * call runs the matching `dot` command, so both surfaces share one command
 * tree. Job-only commands stay out, since MCP has no jobs to run them in.
 */
import { NodeStdio } from "@effect/platform-node";
import {
  Duration,
  Effect,
  Layer,
  Logger,
  Option,
  Predicate,
  Schema,
} from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import {
  type AgentToolEntry,
  agentToolManifest,
} from "../../commands/AgentTools.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";

/** A `dot` command run through MCP that failed, timed out or got bad input. */
export class McpToolError extends Schema.TaggedError<McpToolError>()(
  "McpToolError",
  { message: Schema.String },
) {}

const ToolResult = Schema.Struct({
  exitCode: Schema.Int,
  output: Schema.Unknown,
  stderr: Schema.String,
});

const Scalar = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]);

const Input = Schema.Record(
  Schema.String,
  Schema.Union([Scalar, Schema.Array(Scalar)]),
);

type Input = typeof Input.Type;

const decodeInput = Schema.decodeUnknownEffect(Input);

type ToolHandler<T> = Toolkit.HandlersFrom<Toolkit.Tools<T>>[string];

const parseJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Unknown),
);

const commandArgs = Effect.fnUntraced(function* (
  entry: AgentToolEntry,
  input: Input,
) {
  const { directory, ...rest } = input;

  const record = entry.directory ? rest : input;

  const cwd = entry.directory ? directory : undefined;

  const known = [
    ...entry.params.map((param) => param.key),
    ...(entry.directory ? ["directory"] : []),
  ];

  const unknown = Object.keys(input).filter((key) => !known.includes(key));

  if (unknown.length > 0)
    return yield* new McpToolError({
      message: `Unknown input ${unknown.join(", ")}; this tool takes: ${known.join(", ") || "none"}`,
    });

  if (cwd !== undefined && !Predicate.isString(cwd))
    return yield* new McpToolError({
      message: "Invalid input: directory must be a string",
    });

  const flags: string[] = [];
  const positional: string[] = [];

  for (const param of entry.params) {
    const value = record[param.key];

    if (value === undefined) continue;

    const values = (Array.isArray(value) ? value : [value]).map(String);

    if (param.kind === "argument") positional.push(...values);
    else if (param.boolean) {
      if (value === true) flags.push(`--${param.flag}`);
    } else for (const item of values) flags.push(`--${param.flag}`, item);
  }

  return {
    args: [
      ...entry.argv,
      ...positional,
      ...flags,
      ...(entry.json ? ["--json"] : []),
    ],
    cwd,
  };
});

const runTool = (executor: CommandExecutor["Service"], entry: AgentToolEntry) =>
  Effect.fn(`McpServe.${entry.name}`)(function* (input: Input) {
    const { args, cwd } = yield* commandArgs(entry, input);
    const command = `dot ${args.join(" ")}`;

    const run = yield* executor.run("dot", args, { cwd }).pipe(
      Effect.map((stdout) => ({ exitCode: 0, stdout, stderr: "" })),
      Effect.catchTag("CommandError", (error) =>
        entry.exitCodes.includes(error.exitCode)
          ? Effect.succeed({
              exitCode: error.exitCode,
              stdout: error.stdout ?? "",
              stderr: error.stderr,
            })
          : Effect.fail(
              new McpToolError({
                message: `${command} exited ${error.exitCode}: ${error.stderr.trim()}`,
              }),
            ),
      ),
      Effect.timeoutOrElse({
        duration: Duration.millis(entry.timeoutMillis),
        orElse: () =>
          Effect.fail(
            new McpToolError({
              message: `${command} took longer than ${Duration.format(Duration.millis(entry.timeoutMillis))} and was stopped`,
            }),
          ),
      }),
    );

    const output = entry.json
      ? Option.getOrElse(parseJson(run.stdout), () => run.stdout)
      : run.stdout.trim();

    return { exitCode: run.exitCode, output, stderr: run.stderr.trim() };
  });

const toTool = (entry: AgentToolEntry) => {
  const tool = Tool.dynamic(entry.name, {
    description: entry.description,
    parameters: entry.input,
    success: ToolResult,
    failure: McpToolError,
    failureMode: "return",
  });

  return entry.access === "read"
    ? tool.annotate(Tool.Readonly, true)
    : tool.annotate(Tool.Destructive, entry.alwaysAsk);
};

/** Serve every `dot` agent tool that isn't job-only over MCP on stdio. */
export const mcpServe = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const entries = (yield* agentToolManifest).tools.filter(
    (entry) => !entry.jobOnly,
  );

  const toolkit = Toolkit.make(...entries.map(toTool));

  const handlers = Object.fromEntries(
    entries.map((entry): [string, ToolHandler<typeof toolkit>] => {
      const run = runTool(executor, entry);

      return [
        entry.name,
        (params) =>
          decodeInput(params ?? {}).pipe(
            Effect.mapError(
              (error) =>
                new McpToolError({
                  message: `Invalid input: ${error.message}`,
                }),
            ),
            Effect.flatMap(run),
          ),
      ];
    }),
  );

  return yield* Layer.launch(
    McpServer.toolkit(toolkit).pipe(
      Layer.provide(toolkit.toLayer(toolkit.of(handlers))),
      Layer.provide(
        McpServer.layerStdio({
          name: "dot",
          version: "1.0.0",
          protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25],
        }),
      ),
      Layer.provide(NodeStdio.layer),
    ),
  );
}).pipe(
  Effect.provideService(Logger.LogToStderr, true),
  Effect.withSpan("McpServe"),
);
