import { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import type { DotToolFlags } from "./shell-nudge";
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
        directory: Schema.optionalKey(Schema.Boolean),
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
  (argv: readonly string[], params: readonly (typeof Param.Type)[], json: boolean, directory: boolean) =>
  (input: CliInput) =>
    Schema.decodeUnknownEffect(Input)(input).pipe(
      Effect.mapError((error) => new Tool.Error({ message: `Invalid input: ${error.message}` })),
      Effect.flatMap((input): Effect.Effect<{ cwd?: string; record: typeof input }, Tool.Error> => {
        if (!directory) return Effect.succeed({ record: input });

        const { directory: cwd, ...record } = input;

        return cwd === undefined || Schema.is(Schema.String)(cwd)
          ? Effect.succeed({ cwd, record })
          : Effect.fail(new Tool.Error({ message: "Invalid input: directory must be a string" }));
      }),
      Effect.filterOrFail(
        ({ record }) => Object.keys(record).every((key) => params.some((param) => param.key === key)),
        ({ record }) => {
          const unknown = Object.keys(record).filter((key) => !params.some((param) => param.key === key));
          const known = [...params.map((param) => param.key), ...(directory ? ["directory"] : [])].join(", ") || "none";

          return new Tool.Error({ message: `Unknown input ${unknown.join(", ")}; this tool takes: ${known}` });
        },
      ),
      Effect.map(({ cwd, record }) => {
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
          cwd,
        };
      }),
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
        directory: tool.directory,
        input: tool.input,
        invocation: invocation(tool.argv, tool.params, tool.json, tool.directory ?? false),
      } satisfies CliTool,
    }));

    return {
      tools: all.flatMap((entry) => (entry.jobOnly ? [] : [entry.tool])),
      jobs: all.map((entry) => entry.tool),
      flags: new Map(
        tools.map((tool): [string, ReadonlySet<string>] => [
          tool.name,
          new Set([
            ...tool.params.flatMap((param) => (param.kind === "flag" && param.flag !== undefined ? [param.flag] : [])),
            ...(tool.json ? ["json"] : []),
          ]),
        ]),
      ) satisfies DotToolFlags,
    };
  }),
);
