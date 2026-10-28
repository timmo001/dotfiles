import {
  Console,
  Duration,
  Effect,
  Match,
  Option,
  Predicate,
  Schema,
  String as Str,
} from "effect";
import type { Command, Param } from "effect/cli";
import { commandConfig, resolveCliCommand } from "../cli/spec.js";
import {
  argumentType,
  extractSingleParams,
  flagType,
  paramMetadata,
} from "./Completions.js";

/** Whether a tool only reads state or changes something. */
export type AgentToolAccess = "read" | "write";

interface AgentToolSpec {
  readonly access: AgentToolAccess;
  readonly pinned?: boolean;
  readonly timeout?: Duration.Input;
  /** Flags kept out of the tool, such as ones that open a browser or follow output. */
  readonly omit?: readonly string[];
  /** Exit codes that report an outcome rather than a failure (default: 0 only). */
  readonly exitCodes?: readonly number[];
  /** Replaces the command's short description, when the tool behaves differently. */
  readonly description?: string;
  /** Flags always passed, such as one keeping the command non-interactive. */
  readonly fixed?: readonly string[];
  /** Runs only as a detached job, since it takes far longer than a tool call should. */
  readonly jobOnly?: boolean;
}

const DEFAULT_TIMEOUT: Duration.Input = "2 minutes";

/**
 * Commands exposed to agents as Code Mode tools, keyed by command path.
 * Anything not listed stays CLI-only.
 */
const AGENT_TOOLS = {
  "repo search": { access: "read", pinned: true },
  "repo list": { access: "read", pinned: true, omit: ["open"] },
  "pr queue": { access: "read", pinned: true },
  "session status": { access: "read", pinned: true },
  "updates status": { access: "read", pinned: true },
  "services status": { access: "read", pinned: true },
  "session queue": { access: "read" },
  "pr reviews": { access: "read" },
  "pr watch": {
    access: "read",
    timeout: "2 hours",
    omit: ["output", "interval"],
    exitCodes: [0, 1, 3, 124],
    description:
      "Wait for pull request runs, checks and reviews to settle, or for a stopOn point, up to timeout (default: 60 minutes). Returns the outcome, exitCode (0 passed, 1 failed, 3 stopped early with work pending, 124 timed out), open threads, review body findings and the report path holding failed logs and the full review dump.",
  },
  "pr list": { access: "read", omit: ["open"] },
  "agent lint": { access: "read", timeout: "10 minutes" },
  "link git": { access: "read" },
  "herdr context": { access: "read", omit: ["watch"] },
  "herdr agents": { access: "read" },
  "git issues": { access: "read", omit: ["open"] },
  "git diff": { access: "read" },
  "git log show": { access: "read" },
  "report list": { access: "read" },
  "skills validate": { access: "read" },
  "skills check": {
    access: "read",
    timeout: "5 minutes",
    omit: ["open-opencode"],
  },
  "services run logs": { access: "read" },
  "services logs": {
    access: "read",
    description:
      "Open a registered job's logs in a Herdr tab for the repository that owns it.",
  },
  "services investigate": {
    access: "read",
    fixed: ["--print"],
    omit: ["agent", "modifiers", "print"],
    description:
      "Print the brief for investigating a registered job: its recent runs, logs, file locations and the commands to investigate them.",
  },
  "git releases review": { access: "write" },
  "services schedule check": { access: "read" },
  "homeassistant status": { access: "read" },
  "homeassistant logs": { access: "read", omit: ["follow"] },
  "homeassistant stop": { access: "write" },
  snapshot: { access: "read" },
  doctor: { access: "read", timeout: "5 minutes" },
  "report run": { access: "write", timeout: "10 minutes" },
  "services start": { access: "write" },
  "services stop": { access: "write" },
  "session send": { access: "write" },
  "session take": { access: "write" },
  "herdr model": { access: "write" },
  "herdr pane move": { access: "write" },
  "mcp sync": { access: "write" },
  "agent sync": { access: "write" },
  stow: { access: "write", timeout: "5 minutes" },
  update: {
    access: "write",
    jobOnly: true,
    timeout: "30 minutes",
    omit: ["no-self-update", "post-hook-repo", "summary-file", "started-at"],
    exitCodes: [0, 10],
  },
  "updates refresh": { access: "write", timeout: "5 minutes" },
  "repo induct": {
    access: "write",
    fixed: ["--noninteractive"],
    omit: ["noninteractive"],
    description:
      "Preview inducting a local repository into private dot git config from flags and preset defaults. Repeat the reviewed options with commit to save it.",
  },
  reload: { access: "write" },
  "skills consumers add": { access: "write" },
  "skills consumers remove": { access: "write" },
  "notes capture sync": { access: "write", timeout: "5 minutes" },
  "omarchy plugin sync components": { access: "write" },
  "omarchy shell config": { access: "write" },
  "brief dismiss": { access: "write" },
  "git notifications dismiss dependencies": { access: "write" },
  "git notifications dismiss remaining": { access: "write" },
} satisfies Readonly<Record<string, AgentToolSpec>>;

/** How one tool input key maps back to a command-line argument or flag. */
export const AgentToolParam = Schema.Struct({
  key: Schema.String,
  kind: Schema.Literals(["argument", "flag"]),
  flag: Schema.optionalKey(Schema.String),
  boolean: Schema.Boolean,
  variadic: Schema.Boolean,
});

/** How one tool input key maps back to a command-line argument or flag. */
export interface AgentToolParam extends Schema.Schema.Type<
  typeof AgentToolParam
> {}

/** One `dot` command exposed as an agent tool. */
export const AgentToolEntry = Schema.Struct({
  name: Schema.String,
  argv: Schema.Array(Schema.String),
  description: Schema.String,
  access: Schema.Literals(["read", "write"]),
  pinned: Schema.Boolean,
  jobOnly: Schema.Boolean,
  timeoutMillis: Schema.Int,
  exitCodes: Schema.Array(Schema.Int),
  json: Schema.Boolean,
  input: Schema.Unknown,
  params: Schema.Array(AgentToolParam),
});

/** One `dot` command exposed as an agent tool. */
export interface AgentToolEntry extends Schema.Schema.Type<
  typeof AgentToolEntry
> {}

/** Every `dot` command exposed as an agent tool. */
export const AgentToolManifest = Schema.Struct({
  tools: Schema.Array(AgentToolEntry),
});

/** Every `dot` command exposed as an agent tool. */
export interface AgentToolManifest extends Schema.Schema.Type<
  typeof AgentToolManifest
> {}

/** A listed agent tool that the command tree can't describe. */
export class AgentToolError extends Schema.TaggedError<AgentToolError>()(
  "AgentToolError",
  { message: Schema.String },
) {}

const inputKey = (name: string) => Str.snakeToCamel(Str.kebabToSnake(name));

const valueSchema = (type: ReturnType<typeof flagType>): Schema.Top =>
  Match.value(type).pipe(
    Match.tag("Boolean", (): Schema.Top => Schema.Boolean),
    Match.tag("Int", (): Schema.Top => Schema.Int),
    Match.tag("Finite", (): Schema.Top => Schema.Finite),
    Match.tag("Choice", ({ values }): Schema.Top => Schema.Literals(values)),
    Match.orElse((): Schema.Top => Schema.String),
  );

const field = (
  single: Param.Single<Param.ParamKind, unknown>,
  type: ReturnType<typeof flagType>,
  metadata: { readonly isOptional: boolean; readonly isVariadic: boolean },
) => {
  const base = metadata.isVariadic
    ? Schema.Array(valueSchema(type))
    : valueSchema(type);

  const value = Option.match(single.description, {
    onNone: () => base,
    onSome: (description) => base.annotate({ description }),
  });

  return metadata.isOptional || metadata.isVariadic
    ? Schema.optionalKey(value)
    : value;
};

const describeTool = Effect.fnUntraced(function* (
  path: string,
  spec: AgentToolSpec,
) {
  const argv = path.split(" ");
  const resolved = resolveCliCommand(argv);

  if (resolved.rest !== undefined || resolved.path.join(" ") !== path)
    return yield* new AgentToolError({
      message: `Agent tool ${path} is not a dot command`,
    });

  const command: Command.Command.Any = resolved.command;
  const config = commandConfig(command);
  const omitted = new Set(["json", "help", ...(spec.omit ?? [])]);
  const fields: Record<string, Schema.Top> = {};
  const params: AgentToolParam[] = [];
  let json = false;

  for (const argument of config.arguments) {
    const metadata = paramMetadata(argument);

    for (const single of extractSingleParams(argument)) {
      const key = inputKey(single.name);
      fields[key] = field(single, argumentType(single), metadata);
      params.push({
        key,
        kind: "argument",
        boolean: false,
        variadic: metadata.isVariadic,
      });
    }
  }

  for (const flag of config.flags) {
    const metadata = paramMetadata(flag);

    for (const single of extractSingleParams(flag)) {
      if (single.kind !== "flag" || single.hidden) continue;

      if (single.name === "json") json = true;

      if (omitted.has(single.name)) continue;

      const key = inputKey(single.name);
      const type = flagType(single);
      const boolean = Predicate.isTagged(type, "Boolean");

      if (key in fields)
        return yield* new AgentToolError({
          message: `Agent tool ${path} has two inputs named ${key}`,
        });

      fields[key] = field(single, type, {
        isOptional: metadata.isOptional || boolean,
        isVariadic: metadata.isVariadic,
      });
      params.push({
        key,
        kind: "flag",
        flag: single.name,
        boolean,
        variadic: metadata.isVariadic,
      });
    }
  }

  const { schema } = Schema.toJsonSchemaDocument(Schema.Struct(fields), {
    onExcessProperty: "error",
  });

  return {
    name: argv.join("_").replaceAll("-", "_"),
    argv: [...argv, ...(spec.fixed ?? [])],
    description:
      spec.description ?? command.shortDescription ?? command.description ?? "",
    access: spec.access,
    pinned: spec.pinned ?? false,
    jobOnly: spec.jobOnly ?? false,
    timeoutMillis: Duration.toMillis(spec.timeout ?? DEFAULT_TIMEOUT),
    exitCodes: spec.exitCodes ?? [0],
    json,
    input: schema,
    params,
  } satisfies AgentToolEntry;
});

/** Build the agent tool manifest from the `dot` command tree. */
export const agentToolManifest = Effect.forEach(
  Object.entries(AGENT_TOOLS),
  ([path, spec]) => describeTool(path, spec),
).pipe(
  Effect.map((tools): AgentToolManifest => ({ tools })),
  Effect.withSpan("AgentTools.manifest"),
);

/** Print the agent tool manifest as JSON, or a short list of tools. */
export const agentTools = Effect.fn("AgentTools.print")(function* (options: {
  readonly json: boolean;
}) {
  const manifest = yield* agentToolManifest;

  if (options.json)
    return yield* Console.log(
      yield* Schema.encodeEffect(Schema.fromJsonString(AgentToolManifest))(
        manifest,
      ),
    );

  for (const tool of manifest.tools)
    yield* Console.log(
      `${tool.access === "write" ? "write" : "read "} ${tool.pinned ? "*" : " "} ${tool.jobOnly ? "job " : ""}${tool.argv.join(" ")}`,
    );
});
