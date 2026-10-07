import { join } from "node:path";
import { Console, Effect, FileSystem, Schema } from "effect";
import { isAgent } from "../lib/agent.js";
import { writeFileAtomic } from "../lib/atomicWrite.js";
import { ENV, envString } from "../lib/env.js";
import { CONFIG_DIR, STATE_DIR, expandHomePath } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { herdrRepoOpen } from "./HerdrRepoOpen.js";
import { type StatusRunOptions, statusOf, statusRun } from "./StatusRun.js";

/** Home Assistant dev command failure. */
export class HomeAssistantError extends Schema.TaggedError<HomeAssistantError>()(
  "HomeAssistantError",
  { message: Schema.String },
) {}

const CONFIG_FILE = join(CONFIG_DIR, "dot", "homeassistant.yml");

/** Arguments for the serve daemon, read by its pitchfork `run` script. */
const SERVE_ARGS_FILE = join(STATE_DIR, "dot", "homeassistant", "serve.args");

const Repository = Schema.Struct({
  directory: Schema.String,
  workspace: Schema.String,
});

const ServeTarget = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
  daemon: Schema.optional(Schema.String),
});

const HomeAssistantConfig = Schema.Struct({
  core: Schema.Struct({
    ...Repository.fields,
    daemon: Schema.String,
    url: Schema.String,
  }),
  frontend: Schema.Struct({
    ...Repository.fields,
    build: Schema.String,
    serve: Schema.Struct({
      daemon: Schema.String,
      url: Schema.String,
      targets: Schema.Record(Schema.String, ServeTarget),
    }),
  }),
});

type HomeAssistantConfig = typeof HomeAssistantConfig.Type;

type Repository = typeof Repository.Type;

/** Frontend dev servers run through the frontend's own background mode. */
export const FRONTEND_SUITES = {
  gallery: { title: "Gallery", script: "dev:gallery", translations: true },
  demo: { title: "Demo", script: "dev:demo", translations: true },
  e2e: { title: "E2E App", script: "test:e2e:app:dev", translations: false },
} as const;

/** Frontend suite name accepted by `dot homeassistant frontend <suite>`. */
export type FrontendSuite = keyof typeof FRONTEND_SUITES;

const SUITE_NAMES: readonly FrontendSuite[] = ["gallery", "demo", "e2e"];

const decodeConfig = Schema.decodeUnknownEffect(HomeAssistantConfig);

const loadConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const text = yield* fs.readFileString(CONFIG_FILE).pipe(
    Effect.mapError(
      () =>
        new HomeAssistantError({
          message: `Could not read ${CONFIG_FILE}`,
        }),
    ),
  );

  const config = yield* Effect.try(() => Bun.YAML.parse(text)).pipe(
    Effect.flatMap((parsed) =>
      decodeConfig(parsed, { onExcessProperty: "error" }),
    ),
    Effect.mapError(
      (error) =>
        new HomeAssistantError({
          message: `Invalid ${CONFIG_FILE}: ${error.message}`,
        }),
    ),
  );

  return {
    ...config,
    core: { ...config.core, directory: expandHomePath(config.core.directory) },
    frontend: {
      ...config.frontend,
      directory: expandHomePath(config.frontend.directory),
    },
  } satisfies HomeAssistantConfig;
}).pipe(Effect.withSpan("HomeAssistant.loadConfig"));

const fail = (message: string) => new HomeAssistantError({ message });

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * Abort a rebase left in progress by a failed pull or rebase.
 *
 * @returns Whether a rebase was in progress and has been aborted, restoring
 *   the branch to its pre-rebase state.
 */
export const abortGitRebase = Effect.fn("HomeAssistant.abortRebase")(function* (
  cwd: string,
) {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;

  const inProgress = yield* Effect.gen(function* () {
    for (const directory of ["rebase-merge", "rebase-apply"]) {
      const relative = yield* executor
        .run("git", ["rev-parse", "--git-path", directory], { cwd })
        .pipe(
          Effect.map((output) => output.trim()),
          Effect.orElseSucceed(() => ""),
        );

      if (relative.length === 0) continue;

      const path = relative.startsWith("/") ? relative : join(cwd, relative);

      if (yield* fs.exists(path)) return true;
    }

    return false;
  });

  if (!inProgress) return false;

  const exitCode = yield* executor.inherit("git", ["rebase", "--abort"], {
    cwd,
  });

  if (exitCode !== 0)
    return yield* fail(`git rebase --abort exited with ${exitCode}`);

  return true;
});

const daemonStatus = Effect.fn("HomeAssistant.daemonStatus")(function* (
  daemon: string,
) {
  const executor = yield* CommandExecutor;

  return yield* executor.run("pitchfork", ["status", daemon]).pipe(
    Effect.map(statusOf),
    Effect.orElseSucceed(() => "unknown"),
  );
});

const WorkspaceList = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      workspaces: Schema.Array(
        Schema.Struct({ label: Schema.String, workspace_id: Schema.String }),
      ),
    }),
  }),
);

/** Whether this shell runs inside the repository's Herdr workspace. */
const inWorkspace = Effect.fn("HomeAssistant.inWorkspace")(function* (
  label: string,
) {
  const executor = yield* CommandExecutor;
  const current = envString(ENV.HERDR_WORKSPACE_ID);

  if (!current) return false;

  const list = yield* executor.run("herdr", ["workspace", "list"]).pipe(
    Effect.flatMap(Schema.decodeEffect(WorkspaceList)),
    Effect.orElseSucceed(() => undefined),
  );

  return (
    list?.result.workspaces.find((workspace) => workspace.label === label)
      ?.workspace_id === current
  );
});

const statusRunArgs = (options: StatusRunOptions) => [
  "--title",
  options.title,
  ...(options.url ? ["--url", options.url] : []),
  ...(options.via ? ["--via", options.via] : []),
  ...(options.setup ? ["--setup", options.setup] : []),
  ...(options.pitchfork ? ["--pitchfork", options.pitchfork] : []),
  ...options.conflicts.flatMap((conflict) => ["--conflicts", conflict]),
  ...(options.attach ? ["--attach"] : []),
  ...(options.background ? ["--background"] : []),
  ...(options.command.length > 0 ? ["--", ...options.command] : []),
];

/**
 * Run under `dot status-run` in the repository. Under Herdr, outside the
 * repository's workspace, it opens a tab there instead, as the shell functions
 * did.
 */
const launch = Effect.fn("HomeAssistant.launch")(function* (
  repository: Repository,
  options: StatusRunOptions,
  noFocus = false,
) {
  if (
    envString(ENV.HERDR_ENV) === "1" &&
    !(yield* inWorkspace(repository.workspace))
  ) {
    const prefix = /^\[[^\]]+\]/.exec(repository.workspace)?.[0];

    return yield* herdrRepoOpen({
      layout: "tab",
      label: repository.workspace,
      directory: repository.directory,
      tabLabel: options.title,
      afterPrefix: prefix,
      noFocus,
      command: ["dot", "status-run", ...statusRunArgs(options)]
        .map(quote)
        .join(" "),
    });
  }

  process.chdir(repository.directory);

  return yield* statusRun(options);
});

/**
 * Agents never get prompts, Herdr tabs or Git setup: a conflicting daemon is
 * an error to report to the user, and a running daemon is reused.
 */
const ensureNoConflicts = Effect.fn("HomeAssistant.ensureNoConflicts")(
  function* (conflicts: readonly string[], what: string) {
    for (const conflict of conflicts) {
      if ((yield* daemonStatus(conflict)) !== "running") continue;

      return yield* fail(
        `${conflict} is running and can't run alongside ${what}. Ask the user before stopping it with dot homeassistant stop.`,
      );
    }
  },
);

/**
 * Fail when a frontend suite holds the build lock that `what` needs. Suites
 * are not pitchfork daemons, so status-run's conflict prompt can't see them.
 */
const ensureNoRunningSuites = Effect.fn("HomeAssistant.ensureNoRunningSuites")(
  function* (what: string, except?: FrontendSuite) {
    const executor = yield* CommandExecutor;
    const { frontend } = yield* loadConfig;

    const running = yield* Effect.filter(
      SUITE_NAMES.filter((suite) => suite !== except),
      (suite) =>
        executor
          .run("pnpm", suiteCommand(suite, "--status"), {
            cwd: frontend.directory,
          })
          .pipe(
            Effect.map((output) => / running at /.test(output)),
            Effect.orElseSucceed(() => false),
          ),
      { concurrency: "unbounded" },
    );

    if (running.length === 0) return;

    const stop = `dot homeassistant stop ${running.join(" ")}`;

    return yield* fail(
      `The ${running.join(", ")} dev server can't run alongside ${what}. ${isAgent() ? `Ask the user before stopping it with ${stop}.` : `Stop it first with ${stop}.`}`,
    );
  },
);

const startDaemonAsAgent = Effect.fn("HomeAssistant.startDaemonAsAgent")(
  function* (daemon: string, url: string, conflicts: readonly string[]) {
    const executor = yield* CommandExecutor;

    yield* ensureNoConflicts(conflicts, daemon);

    if ((yield* daemonStatus(daemon)) === "running")
      return yield* Console.log(`${daemon} is already running at ${url}`);

    const exitCode = yield* executor.inherit("pitchfork", ["start", daemon]);

    if (exitCode !== 0)
      return yield* fail(`pitchfork start ${daemon} exited with ${exitCode}`);

    yield* Console.log(`${daemon} is running at ${url}`);
  },
);

const runAsAgent = Effect.fn("HomeAssistant.runAsAgent")(function* (
  directory: string,
  command: readonly string[],
) {
  const executor = yield* CommandExecutor;
  const [cmd, ...args] = command;
  const exitCode = yield* executor.inherit(cmd, args, { cwd: directory });

  if (exitCode !== 0) process.exitCode = exitCode;
});

const frontendDaemons = (config: HomeAssistantConfig) => [
  config.frontend.build,
  config.frontend.serve.daemon,
];

const section = (title: string) =>
  Console.log(`\n${"-".repeat(32)}\n${title}\n${"-".repeat(32)}`);

/**
 * Prepare Core: on a clean tree, switch to dev and pull it (and with
 * `latest`, rebase onto upstream/dev and push), then create the virtual
 * environment if needed and run script/bootstrap. A rebase that stops on
 * conflicts is aborted so the branch is restored instead of left mid-rebase.
 */
export const coreSetup = Effect.fn("HomeAssistant.coreSetup")(
  function* (options: { readonly latest: boolean }) {
    if (isAgent())
      return yield* fail(
        "Core setup switches, pulls and pushes Core's dev branch. Ask the user to run it.",
      );

    const executor = yield* CommandExecutor;
    const fs = yield* FileSystem.FileSystem;
    const { core } = yield* loadConfig;
    const cwd = core.directory;

    const step = Effect.fn("HomeAssistant.coreSetup.step")(function* (
      cmd: string,
      args: readonly string[],
      env?: Readonly<Record<string, string>>,
    ) {
      const exitCode = yield* executor.inherit(cmd, args, { cwd, env });

      if (exitCode !== 0)
        return yield* fail(
          `${[cmd, ...args].join(" ")} exited with ${exitCode}`,
        );
    });

    const git = (...args: readonly string[]) =>
      executor.run("git", args, { cwd }).pipe(Effect.map((out) => out.trim()));

    const gitRebase = Effect.fn("HomeAssistant.coreSetup.rebase")(function* (
      args: readonly string[],
    ) {
      const exitCode = yield* executor.inherit("git", args, { cwd });

      if (exitCode === 0) return;

      const aborted = yield* abortGitRebase(cwd);

      return yield* fail(
        aborted
          ? `git ${args.join(" ")} exited with ${exitCode}; aborted the rebase and restored the branch`
          : `git ${args.join(" ")} exited with ${exitCode}`,
      );
    });

    yield* section("Git status");
    yield* step("git", ["status"]);

    if ((yield* git("status", "--porcelain")) !== "") {
      yield* Console.log(
        "[WARN] Working tree is not clean, so dev is not switched, pulled or rebased.",
      );
    } else {
      if ((yield* git("rev-parse", "--abbrev-ref", "HEAD")) !== "dev") {
        yield* section("Switching to dev");
        yield* step("git", ["switch", "dev"]);
      }

      yield* section("Pulling dev");
      yield* gitRebase(["pull", "--rebase"]);
      yield* step("git", ["fetch", "upstream", "dev"]);

      if (options.latest) {
        yield* section("Rebasing onto upstream/dev");
        yield* gitRebase(["rebase", "upstream/dev"]);

        const ahead = yield* git("rev-list", "HEAD@{upstream}..HEAD").pipe(
          Effect.orElseSucceed(() => ""),
        );

        if (ahead !== "") {
          yield* section("Pushing dev");
          yield* step("git", ["push", "--force-with-lease"]);
        }
      }
    }

    const venv = join(cwd, ".venv");

    if (!(yield* fs.exists(join(venv, "bin", "python3")))) {
      yield* section("Creating the virtual environment");
      yield* step("script/setup", [], { VIRTUAL_ENV: "" });
    }

    yield* section("Running script/bootstrap");
    yield* step("script/bootstrap", [], {
      VIRTUAL_ENV: venv,
      PATH: `${join(venv, "bin")}:${envString(ENV.PATH) ?? ""}`,
    });
  },
);

/** Start Core serving the local frontend build. */
export const coreDev = Effect.fn("HomeAssistant.coreDev")(function* (options: {
  readonly latest: boolean;
  readonly background: boolean;
  readonly noFocus?: boolean;
}) {
  const config = yield* loadConfig;
  const { core } = config;
  const conflicts = [config.frontend.serve.daemon];

  yield* ensureNoRunningSuites(core.daemon);

  if (isAgent())
    return yield* startDaemonAsAgent(core.daemon, core.url, conflicts);

  return yield* launch(
    core,
    {
      title: options.latest ? "HA Core Dev (latest)" : "HA Core Dev",
      url: core.url,
      setup: `dot homeassistant core setup${options.latest ? " --latest" : ""}`,
      pitchfork: core.daemon,
      conflicts,
      attach: false,
      background: options.background,
      command: [],
    },
    options.noFocus,
  );
});

/** Start the frontend watch build that Core serves. */
export const frontendDev = Effect.fn("HomeAssistant.frontendDev")(
  function* (options: {
    readonly background: boolean;
    readonly attach: boolean;
  }) {
    const config = yield* loadConfig;
    const { frontend } = config;
    const conflicts = [frontend.serve.daemon];

    yield* ensureNoRunningSuites(frontend.build);

    if (isAgent())
      return yield* startDaemonAsAgent(
        frontend.build,
        config.core.url,
        conflicts,
      );

    return yield* launch(frontend, {
      title: "HA Frontend Dev",
      url: config.core.url,
      via: "HA Core",
      setup: "script/bootstrap",
      pitchfork: frontend.build,
      conflicts,
      attach: options.attach,
      background: options.background,
      command: [],
    });
  },
);

/**
 * Start the frontend dev server against a configured target, a Core URL, or
 * its default Core.
 */
export const frontendServe = Effect.fn("HomeAssistant.frontendServe")(
  function* (options: {
    readonly target?: string;
    readonly background: boolean;
  }) {
    const executor = yield* CommandExecutor;
    const config = yield* loadConfig;
    const { frontend } = config;
    const { serve } = frontend;
    const conflicts = [frontend.build];

    const target =
      options.target === undefined
        ? undefined
        : /^https?:\/\//.test(options.target)
          ? { title: options.target, url: options.target, daemon: undefined }
          : serve.targets[options.target];

    if (options.target !== undefined && target === undefined)
      return yield* fail(
        `Unknown serve target ${options.target}. Use a URL or one of: ${Object.keys(serve.targets).join(", ")}`,
      );

    if (isAgent() && (yield* daemonStatus(serve.daemon)) === "running")
      return yield* Console.log(
        `${serve.daemon} is already running at ${serve.url}. Ask the user before restarting it against another Core.`,
      );

    if (isAgent()) yield* ensureNoConflicts(conflicts, serve.daemon);

    yield* ensureNoRunningSuites(serve.daemon);

    if (
      target?.daemon !== undefined &&
      (yield* daemonStatus(target.daemon)) !== "running"
    ) {
      const exitCode = yield* executor.inherit("pitchfork", [
        "start",
        target.daemon,
      ]);

      if (exitCode !== 0)
        return yield* fail(
          `pitchfork start ${target.daemon} exited with ${exitCode}`,
        );
    }

    writeFileAtomic(
      SERVE_ARGS_FILE,
      target ? `-c ${quote(target.url)}\n` : "\n",
      { createDirectory: true },
    );

    if (isAgent())
      return yield* startDaemonAsAgent(serve.daemon, serve.url, conflicts);

    return yield* launch(frontend, {
      title: target
        ? `HA Frontend Serve (${target.title})`
        : "HA Frontend Serve",
      url: serve.url,
      setup: "script/bootstrap",
      pitchfork: serve.daemon,
      conflicts,
      attach: false,
      background: options.background,
      command: [],
    });
  },
);

/**
 * Run a frontend command that takes the frontend's build lock, stopping the
 * frontend daemons first.
 */
const frontendLocked = Effect.fn("HomeAssistant.frontendLocked")(function* (
  title: string,
  command: readonly string[],
  setup: boolean,
  suite?: FrontendSuite,
) {
  const config = yield* loadConfig;
  const { frontend } = config;
  const conflicts = frontendDaemons(config);

  yield* ensureNoRunningSuites(title, suite);

  if (isAgent()) {
    yield* ensureNoConflicts(conflicts, title);

    return yield* runAsAgent(frontend.directory, command);
  }

  return yield* launch(frontend, {
    title,
    setup: setup ? "script/bootstrap" : undefined,
    conflicts,
    attach: false,
    background: false,
    command,
  });
});

/** Start a frontend suite dev server: the gallery, demo or e2e app. */
export const frontendSuite = Effect.fn("HomeAssistant.frontendSuite")(
  function* (suite: FrontendSuite, options: { readonly background: boolean }) {
    const { title, script, translations } = FRONTEND_SUITES[suite];

    return yield* frontendLocked(
      `HA Frontend ${title}`,
      [
        "pnpm",
        script,
        ...(translations ? ["--fetch-translations"] : []),
        ...(options.background || isAgent() ? ["--background"] : []),
      ],
      true,
      suite,
    );
  },
);

/** Run the frontend production build. */
export const frontendBuild = frontendLocked(
  "HA Frontend Build",
  ["pnpm", "build"],
  false,
);

/** Run the frontend e2e tests, which build their suites first. */
export const frontendTestE2e = Effect.fn("HomeAssistant.frontendTestE2e")(
  function* (suite: string | undefined) {
    return yield* frontendLocked(
      "HA Frontend E2E Tests",
      ["pnpm", suite ? `test:e2e:${suite}` : "test:e2e"],
      false,
    );
  },
);

/** Start Core and the frontend build in their own Herdr tabs. */
export const homeAssistantDev = Effect.fn("HomeAssistant.dev")(
  function* (options: { readonly background: boolean }) {
    if (isAgent()) return yield* coreDev({ latest: false, background: true });

    if (envString(ENV.HERDR_ENV) !== "1")
      return yield* fail("dot homeassistant dev requires Herdr");

    yield* coreDev({
      latest: true,
      background: options.background,
      noFocus: true,
    });

    return yield* frontendDev({
      background: options.background,
      attach: true,
    });
  },
);

/** A daemon or suite that `status`, `stop` and `logs` act on. */
type Target =
  | { readonly kind: "daemon"; readonly name: string; readonly url?: string }
  | { readonly kind: "suite"; readonly suite: FrontendSuite };

const allTargets = (config: HomeAssistantConfig) => {
  const targets = new Map<string, Target>([
    [
      "core",
      { kind: "daemon", name: config.core.daemon, url: config.core.url },
    ],
    [
      "build",
      { kind: "daemon", name: config.frontend.build, url: config.core.url },
    ],
    [
      "serve",
      {
        kind: "daemon",
        name: config.frontend.serve.daemon,
        url: config.frontend.serve.url,
      },
    ],
  ]);

  for (const [name, target] of Object.entries(config.frontend.serve.targets))
    if (target.daemon !== undefined)
      targets.set(name, {
        kind: "daemon",
        name: target.daemon,
        url: target.url,
      });

  for (const suite of SUITE_NAMES) targets.set(suite, { kind: "suite", suite });

  return targets;
};

const selectTargets = Effect.fn("HomeAssistant.selectTargets")(function* (
  names: readonly string[],
) {
  const config = yield* loadConfig;
  const targets = allTargets(config);

  if (names.length === 0) return { config, selected: [...targets.values()] };

  const selected: Target[] = [];

  for (const name of names) {
    const target = targets.get(name);

    if (target === undefined)
      return yield* fail(
        `Unknown target ${name}. Use one of: ${[...targets.keys()].join(", ")}`,
      );

    selected.push(target);
  }

  return { config, selected };
});

const suiteCommand = (suite: FrontendSuite, flag: string) => [
  FRONTEND_SUITES[suite].script,
  flag,
];

/** Show the state of the Home Assistant daemons and frontend suites. */
export const homeAssistantStatus = Effect.fn("HomeAssistant.status")(function* (
  names: readonly string[],
) {
  const executor = yield* CommandExecutor;
  const { config, selected } = yield* selectTargets(names);

  for (const target of selected) {
    if (target.kind === "daemon") {
      const status = yield* daemonStatus(target.name);
      yield* Console.log(
        `${target.name}  ${status}${target.url ? `  ${target.url}` : ""}`,
      );
      continue;
    }

    yield* executor.inherit("pnpm", suiteCommand(target.suite, "--status"), {
      cwd: config.frontend.directory,
    });
  }
});

/** Stop Home Assistant daemons and frontend suites; all of them by default. */
export const homeAssistantStop = Effect.fn("HomeAssistant.stop")(function* (
  names: readonly string[],
) {
  const executor = yield* CommandExecutor;
  const { config, selected } = yield* selectTargets(names);

  const daemons = selected.flatMap((target) =>
    target.kind === "daemon" ? [target.name] : [],
  );

  if (daemons.length > 0)
    yield* executor.inherit("pitchfork", ["stop", ...daemons]);

  for (const target of selected)
    if (target.kind === "suite")
      yield* executor.inherit("pnpm", suiteCommand(target.suite, "--stop"), {
        cwd: config.frontend.directory,
      });
});

/** Print or follow a daemon's or suite's logs. */
export const homeAssistantLogs = Effect.fn("HomeAssistant.logs")(function* (
  name: string,
  options: { readonly follow: boolean; readonly lines: number },
) {
  const executor = yield* CommandExecutor;
  const { config, selected } = yield* selectTargets([name]);
  const [target] = selected;

  if (options.follow && isAgent())
    return yield* fail(
      "--follow never returns. Read recent lines with --lines instead.",
    );

  if (target.kind === "daemon")
    return yield* executor.inherit("pitchfork", [
      "logs",
      "--no-pager",
      ...(options.follow ? ["--tail"] : ["-n", String(options.lines)]),
      target.name,
    ]);

  const args = suiteCommand(target.suite, "--logs");

  if (options.follow)
    return yield* executor.inherit("pnpm", [...args, "--follow"], {
      cwd: config.frontend.directory,
    });

  // The frontend prints the whole log file, so keep only the last lines.
  const output = yield* executor.run("pnpm", args, {
    cwd: config.frontend.directory,
    mergeStderr: true,
  });

  yield* Console.log(
    output.trimEnd().split("\n").slice(-options.lines).join("\n"),
  );

  return 0;
});
