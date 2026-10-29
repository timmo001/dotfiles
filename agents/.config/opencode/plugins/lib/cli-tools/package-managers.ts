import { Effect, Layer, Schema } from "effect";
import { type ClientNamespace, type ClientTool, clientTools, commandExists, runCli, runCliOutput } from "./tool";

const tool = clientTools(Layer.empty);

const directory = Schema.optionalKey(
  Schema.String.check(Schema.isStartingWith("/")).annotate({
    description: "An absolute directory to run in instead of the session's",
  }),
);

const args = Schema.optionalKey(Schema.Array(Schema.String));

const packages = Schema.NonEmptyArray(Schema.String).annotate({ description: "Packages such as lit or lit@3" });

/** The directory a call runs in: its own `directory`, or the session's. */
const cwd = (input: { readonly directory?: string }, context: { readonly directory: string }) =>
  input.directory ?? context.directory;

/** How one package manager spells each operation. */
interface PackageManager {
  readonly command: "pnpm" | "bun" | "npm";
  readonly description: string;
  readonly run: (script: string, args: readonly string[]) => readonly string[];
  /** Runs a binary from the project's dependencies, never downloading one. */
  readonly exec: (command: string, args: readonly string[]) => readonly string[];
  readonly install: (frozen: boolean) => readonly string[];
  readonly add: (packages: readonly string[], dev: boolean, exact: boolean) => readonly string[];
  readonly remove: (packages: readonly string[]) => readonly string[];
  readonly outdated: (packages: readonly string[]) => readonly string[];
  /** Exit codes `outdated` uses to report outdated packages rather than a failure. */
  readonly outdatedExitCodes: readonly number[];
  readonly why: (name: string) => readonly string[];
}

/**
 * Run a script or binary and return its exit code with all of its output, so failing lints and
 * tests come back in full rather than as an error's last lines.
 */
const runToEnd = (command: string, argv: readonly string[], dir: string) =>
  Effect.map(runCli(command, argv, { cwd: dir, timeout: "30 minutes", mergeStderr: true }), (run) => ({
    exitCode: run.exitCode,
    output: run.stdout.trimEnd(),
  }));

const commandLine = (command: string, argv: readonly string[]) => [command, ...argv].join(" ");

const packageManagerTools = (pm: PackageManager): readonly ClientTool[] => [
  tool({
    name: "run",
    description:
      "Run a package.json script and wait for it, returning its exit code and full output. Long-running servers belong in pitchfork instead.",
    access: "write",
    timeout: "30 minutes",
    input: Schema.Struct({ directory, script: Schema.String, args }),
    resource: (input) => input.script,
    summary: (input) => commandLine(pm.command, pm.run(input.script, input.args ?? [])),
    run: (input, context) => runToEnd(pm.command, pm.run(input.script, input.args ?? []), cwd(input, context)),
  }),
  tool({
    name: "exec",
    description:
      "Run a binary from the project's dependencies, such as eslint or tsc, returning its exit code and full output. Never downloads a missing one.",
    access: "write",
    timeout: "30 minutes",
    input: Schema.Struct({ directory, command: Schema.String, args }),
    resource: (input) => input.command,
    summary: (input) => commandLine(pm.command, pm.exec(input.command, input.args ?? [])),
    run: (input, context) => runToEnd(pm.command, pm.exec(input.command, input.args ?? []), cwd(input, context)),
  }),
  tool({
    name: "install",
    description: "Install the project's dependencies. frozen fails instead of changing the lockfile.",
    access: "write",
    timeout: "15 minutes",
    input: Schema.Struct({ directory, frozen: Schema.optionalKey(Schema.Boolean) }),
    resource: (input) => (input.frozen ? "frozen" : "lockfile"),
    summary: (input) => commandLine(pm.command, pm.install(input.frozen ?? false)),
    run: (input, context) =>
      runCliOutput(pm.command, pm.install(input.frozen ?? false), {
        cwd: cwd(input, context),
        timeout: "15 minutes",
        mergeStderr: true,
      }),
  }),
  tool({
    name: "add",
    description: "Add dependencies to package.json and install them. exact pins the exact version.",
    access: "write",
    timeout: "15 minutes",
    input: Schema.Struct({
      directory,
      packages,
      dev: Schema.optionalKey(Schema.Boolean),
      exact: Schema.optionalKey(Schema.Boolean),
    }),
    resource: (input) => input.packages.join(" "),
    summary: (input) => commandLine(pm.command, pm.add(input.packages, input.dev ?? false, input.exact ?? false)),
    run: (input, context) =>
      runCliOutput(pm.command, pm.add(input.packages, input.dev ?? false, input.exact ?? false), {
        cwd: cwd(input, context),
        timeout: "15 minutes",
        mergeStderr: true,
      }),
  }),
  tool({
    name: "remove",
    description: "Remove dependencies from package.json and the install.",
    access: "write",
    timeout: "15 minutes",
    input: Schema.Struct({ directory, packages: Schema.NonEmptyArray(Schema.String).annotate({ description: "Package names" }) }),
    resource: (input) => input.packages.join(" "),
    summary: (input) => commandLine(pm.command, pm.remove(input.packages)),
    run: (input, context) =>
      runCliOutput(pm.command, pm.remove(input.packages), {
        cwd: cwd(input, context),
        timeout: "15 minutes",
        mergeStderr: true,
      }),
  }),
  tool({
    name: "outdated",
    description: "List dependencies with newer releases, all of them or those named.",
    access: "read",
    input: Schema.Struct({ directory, packages: Schema.optionalKey(Schema.Array(Schema.String)) }),
    run: (input, context) =>
      runCliOutput(pm.command, pm.outdated(input.packages ?? []), {
        cwd: cwd(input, context),
        exitCodes: pm.outdatedExitCodes,
      }),
  }),
  tool({
    name: "why",
    description: "Show why a package is installed: the dependency chains that pull it in.",
    access: "read",
    input: Schema.Struct({ directory, package: Schema.String }),
    run: (input, context) => runCliOutput(pm.command, pm.why(input.package), { cwd: cwd(input, context) }),
  }),
];

const namespace = (pm: PackageManager, extra: readonly ClientTool[] = []): ClientNamespace => ({
  kind: "client",
  command: pm.command,
  description: pm.description,
  available: commandExists(pm.command),
  tools: [...packageManagerTools(pm), ...extra],
});

const flagWhen = (set: boolean, flag: string) => (set ? [flag] : []);

/** pnpm in the session's directory, or another with directory. */
export const pnpmNamespace = namespace({
  command: "pnpm",
  description:
    "pnpm in the session's directory, or another with directory: run package.json scripts and dependency binaries with their full output, install, add or remove dependencies, and list outdated ones or why one is installed.",
  run: (script, rest) => ["run", script, ...rest],
  exec: (command, rest) => ["exec", command, ...rest],
  install: (frozen) => ["install", ...flagWhen(frozen, "--frozen-lockfile")],
  add: (names, dev, exact) => ["add", ...flagWhen(dev, "--save-dev"), ...flagWhen(exact, "--save-exact"), ...names],
  remove: (names) => ["remove", ...names],
  outdated: (names) => ["outdated", ...names],
  outdatedExitCodes: [0, 1],
  why: (name) => ["why", name],
});

/** npm in the session's directory, or another with directory. */
export const npmNamespace = namespace({
  command: "npm",
  description:
    "npm in the session's directory, or another with directory: run package.json scripts and dependency binaries with their full output, install, add or remove dependencies, and list outdated ones or why one is installed.",
  run: (script, rest) => ["run", script, ...(rest.length > 0 ? ["--", ...rest] : [])],
  exec: (command, rest) => ["exec", "--no", "--", command, ...rest],
  install: (frozen) => [frozen ? "ci" : "install"],
  add: (names, dev, exact) => ["install", ...flagWhen(dev, "--save-dev"), ...flagWhen(exact, "--save-exact"), ...names],
  remove: (names) => ["uninstall", ...names],
  outdated: (names) => ["outdated", ...names],
  outdatedExitCodes: [0, 1],
  why: (name) => ["explain", name],
});

/** bun's package manager and test runner in the session's directory, or another with directory. */
export const bunNamespace = namespace(
  {
    command: "bun",
    description:
      "bun in the session's directory, or another with directory: run package.json scripts, dependency binaries and bun test with their full output, install, add or remove dependencies, and list outdated ones or why one is installed.",
    run: (script, rest) => ["run", script, ...rest],
    exec: (command, rest) => ["x", "--no-install", command, ...rest],
    install: (frozen) => ["install", ...flagWhen(frozen, "--frozen-lockfile")],
    add: (names, dev, exact) => ["add", ...flagWhen(dev, "--dev"), ...flagWhen(exact, "--exact"), ...names],
    remove: (names) => ["remove", ...names],
    outdated: (names) => ["outdated", ...names],
    outdatedExitCodes: [0],
    why: (name) => ["why", name],
  },
  [
    tool({
      name: "test",
      description: "Run bun's test runner, returning its exit code and full output.",
      access: "write",
      timeout: "30 minutes",
      input: Schema.Struct({
        directory,
        filters: Schema.optionalKey(Schema.Array(Schema.String)).annotate({ description: "Test file paths or name filters" }),
        args,
      }),
      resource: (input) => (input.filters?.length ? input.filters.join(" ") : "all"),
      summary: (input) => commandLine("bun", ["test", ...(input.filters ?? []), ...(input.args ?? [])]),
      run: (input, context) =>
        runToEnd("bun", ["test", ...(input.filters ?? []), ...(input.args ?? [])], cwd(input, context)),
    }),
  ],
);
