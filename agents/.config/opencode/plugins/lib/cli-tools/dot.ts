import { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { type CliInput, type CliTool, runCli } from "./tool";

const Param = Schema.Struct({
  key: Schema.String,
  kind: Schema.Literals(["argument", "flag"]),
  flag: Schema.optionalKey(Schema.String),
  boolean: Schema.Boolean,
  variadic: Schema.Boolean,
});

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        argv: Schema.Array(Schema.String),
        description: Schema.String,
        access: Schema.Literals(["read", "write"]),
        pinned: Schema.Boolean,
        jobOnly: Schema.optionalKey(Schema.Boolean),
        alwaysAsk: Schema.optionalKey(Schema.Boolean),
        timeoutMillis: Schema.Int,
        exitCodes: Schema.optionalKey(Schema.Array(Schema.Int)),
        json: Schema.Boolean,
        input: Schema.Record(Schema.String, Schema.Unknown),
        params: Schema.Array(Param),
      }),
    ),
  }),
);

const Scalar = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]);

const Input = Schema.Record(Schema.String, Schema.Union([Scalar, Schema.Array(Scalar)]));

const invocation =
  (argv: readonly string[], params: readonly (typeof Param.Type)[], json: boolean) =>
  (input: CliInput) =>
    Schema.decodeUnknownEffect(Input)(input).pipe(
      Effect.map((record) => {
        const flags: string[] = [];
        const positional: string[] = [];

        for (const param of params) {
          const value = record[param.key];

          if (value === undefined) continue;

          const values = (Array.isArray(value) ? value : [value]).map(String);

          if (param.kind === "argument") positional.push(...values);
          else if (param.boolean) {
            if (value === true) flags.push(`--${param.flag}`);
          } else for (const item of values) flags.push(`--${param.flag}`, item);
        }

        return {
          args: [...argv, ...positional, ...flags, ...(json ? ["--json"] : [])],
        };
      }),
      Effect.mapError((error) => new Tool.Error({ message: `Invalid input: ${error.message}` })),
    );

/**
 * Read the `dot` commands exposed as tools from `dot agent tools --json`. Job-only commands are
 * not tools of their own; `jobs.start` runs them as `dot.<name>`.
 */
export const loadDotTools = runCli("dot", ["agent", "tools", "--json"], {
  timeout: "30 seconds",
}).pipe(
  Effect.filterOrFail(
    (run) => run.exitCode === 0,
    (run) =>
      new Tool.Error({ message: `dot agent tools exited ${run.exitCode}: ${run.stderr.trim()}` }),
  ),
  Effect.flatMap((run) => Schema.decodeUnknownEffect(Manifest)(run.stdout)),
  Effect.map(({ tools }) => {
    const all = tools.map((tool) => ({
      jobOnly: tool.jobOnly ?? false,
      tool: {
        name: tool.name,
        description: tool.description,
        access: tool.access,
        pinned: tool.pinned,
        timeout: tool.timeoutMillis,
        json: tool.json,
        exitCodes: tool.exitCodes,
        alwaysAsk: tool.alwaysAsk,
        input: tool.input,
        invocation: invocation(tool.argv, tool.params, tool.json),
      } satisfies CliTool,
    }));

    return {
      tools: all.flatMap((entry) => (entry.jobOnly ? [] : [entry.tool])),
      jobs: all.map((entry) => entry.tool),
    };
  }),
);
