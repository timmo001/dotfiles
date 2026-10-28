import { Duration, Effect, Layer, Schema } from "effect";
import { type ClientNamespace, clientTools, commandExists, runCliOutput, toToolError } from "./tool";

const tool = clientTools(Layer.empty);

const directory = Schema.optionalKey(
  Schema.String.check(Schema.isStartingWith("/")).annotate({
    description: "An absolute directory to run in instead of the session's",
  }),
);

const tools = Schema.Array(Schema.String).annotate({ description: "Tools such as node or node@24" });

/** The directory a call runs in: its own `directory`, or the session's. */
const cwd = (input: { readonly directory?: string }, context: { readonly directory: string }) =>
  input.directory ?? context.directory;

const mise = (args: readonly string[], dir: string, options: { json?: boolean; timeout?: Duration.Input } = {}) =>
  runCliOutput("mise", ["--yes", ...args], { cwd: dir, json: options.json, timeout: options.timeout });

const Variables = Schema.Record(Schema.String, Schema.String);

/** mise tools, tasks, environment and config. */
export const miseNamespace: ClientNamespace = {
  kind: "client",
  command: "mise",
  description:
    "mise in the session's directory, or another with directory: list tasks, installed and outdated tools, the environment and config files, and run tasks, install, pin or upgrade tools, and trust config files.",
  available: commandExists("mise"),
  tools: [
    tool({
      name: "tasks",
      description: "List the tasks available here, with their descriptions and sources.",
      access: "read",
      pinned: true,
      input: Schema.Struct({
        directory,
        hidden: Schema.optionalKey(Schema.Boolean),
        all: Schema.optionalKey(Schema.Boolean).annotate({ description: "Every project in the monorepo" }),
      }),
      run: (input, context) =>
        mise(["tasks", "ls", "--json", ...(input.hidden ? ["--hidden"] : []), ...(input.all ? ["--all"] : [])], cwd(input, context), {
          json: true,
        }),
    }),
    tool({
      name: "tools",
      description: "List installed tools with their versions, whether they're active here, and the config requesting them.",
      access: "read",
      input: Schema.Struct({
        directory,
        current: Schema.optionalKey(Schema.Boolean).annotate({ description: "Only tools the config here requests" }),
      }),
      run: (input, context) =>
        mise(["ls", "--json", ...(input.current ? ["--current"] : [])], cwd(input, context), { json: true }),
    }),
    tool({
      name: "outdated",
      description: "List tools whose installed version is older than their config allows, or than the newest release with bump.",
      access: "read",
      input: Schema.Struct({ directory, tools: Schema.optionalKey(tools), bump: Schema.optionalKey(Schema.Boolean) }),
      run: (input, context) =>
        mise(["outdated", "--json", ...(input.bump ? ["--bump"] : []), ...(input.tools ?? [])], cwd(input, context), {
          json: true,
          timeout: "2 minutes",
        }),
    }),
    tool({
      name: "env",
      description: "Read the environment mise sets here. Values of variables marked for redaction are masked.",
      access: "read",
      input: Schema.Struct({ directory }),
      run: (input, context) =>
        Effect.gen(function* () {
          const dir = cwd(input, context);
          const decode = Schema.decodeUnknownEffect(Variables);
          const all = yield* Effect.flatMap(mise(["env", "--json"], dir, { json: true }), decode);
          const redacted = yield* Effect.flatMap(mise(["env", "--json", "--redacted"], dir, { json: true }), decode);

          return Object.fromEntries(
            Object.entries(all).map(([name, value]) => [name, name in redacted ? "[redacted]" : value]),
          );
        }).pipe(Effect.mapError(toToolError)),
    }),
    tool({
      name: "config",
      description: "List the config files in use here, lowest precedence first, with the tools each requests.",
      access: "read",
      input: Schema.Struct({ directory }),
      run: (input, context) => mise(["config", "ls", "--json"], cwd(input, context), { json: true }),
    }),
    tool({
      name: "run",
      description:
        "Run tasks and wait for their output. Several tasks run in parallel. Long-running servers belong in pitchfork instead.",
      access: "write",
      timeout: "30 minutes",
      input: Schema.Struct({
        directory,
        tasks: Schema.NonEmptyArray(
          Schema.Struct({
            name: Schema.String,
            args: Schema.optionalKey(Schema.Array(Schema.String)),
          }),
        ),
      }),
      resource: (input) => input.tasks.map((task) => [task.name, ...(task.args ?? [])].join(" ")).join(" ::: "),
      summary: (input) => `mise run ${input.tasks.map((task) => task.name).join(" ::: ")}`,
      run: (input, context) =>
        mise(
          ["run", ...input.tasks.flatMap((task, index) => [...(index > 0 ? [":::"] : []), task.name, ...(task.args ?? [])])],
          cwd(input, context),
          { timeout: "30 minutes" },
        ),
    }),
    tool({
      name: "install",
      description: "Install tools, or every missing tool the config here requests when none are given.",
      access: "write",
      timeout: "15 minutes",
      input: Schema.Struct({ directory, tools: Schema.optionalKey(tools) }),
      resource: (input) => (input.tools?.length ? input.tools.join(" ") : "config"),
      summary: (input) => `mise install ${(input.tools ?? []).join(" ")}`.trim(),
      run: (input, context) => mise(["install", ...(input.tools ?? [])], cwd(input, context), { timeout: "15 minutes" }),
    }),
    tool({
      name: "use",
      description:
        "Add or change a tool version in the config here, or the global config with global, installing it. pin writes the exact version.",
      access: "write",
      timeout: "15 minutes",
      input: Schema.Struct({
        directory,
        tools: Schema.NonEmptyArray(Schema.String).annotate({ description: "Tools such as node@24" }),
        global: Schema.optionalKey(Schema.Boolean),
        pin: Schema.optionalKey(Schema.Boolean),
      }),
      resource: (input) => `${input.tools.join(" ")}${input.global ? " global" : ""}`,
      summary: (input) => `mise use ${input.global ? "--global " : ""}${input.pin ? "--pin " : ""}${input.tools.join(" ")}`,
      run: (input, context) =>
        mise(
          ["use", ...(input.global ? ["--global"] : []), ...(input.pin ? ["--pin"] : []), ...input.tools],
          cwd(input, context),
          { timeout: "15 minutes" },
        ),
    }),
    tool({
      name: "upgrade",
      description:
        "Upgrade tools to the newest version their config allows, or every outdated tool when none are given. bump also raises the config's version request.",
      access: "write",
      timeout: "15 minutes",
      input: Schema.Struct({ directory, tools: Schema.optionalKey(tools), bump: Schema.optionalKey(Schema.Boolean) }),
      resource: (input) => `${input.tools?.length ? input.tools.join(" ") : "all"}${input.bump ? " bump" : ""}`,
      summary: (input) => `mise upgrade ${input.bump ? "--bump " : ""}${(input.tools ?? []).join(" ")}`.trim(),
      run: (input, context) =>
        mise(["upgrade", ...(input.bump ? ["--bump"] : []), ...(input.tools ?? [])], cwd(input, context), {
          timeout: "15 minutes",
        }),
    }),
    tool({
      name: "trust",
      description: "Trust a config file, or the one here when no path is given, so mise loads its env and tasks.",
      access: "write",
      input: Schema.Struct({
        directory,
        path: Schema.optionalKey(Schema.String).annotate({ description: "A config file or directory" }),
      }),
      resource: (input) => input.path ?? input.directory ?? "here",
      summary: (input) => `mise trust ${input.path ?? ""}`.trim(),
      run: (input, context) => mise(["trust", ...(input.path === undefined ? [] : [input.path])], cwd(input, context)),
    }),
  ],
};
