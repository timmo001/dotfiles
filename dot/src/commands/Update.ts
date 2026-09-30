import { Clock, Effect, FileSystem, Option, Schema } from "effect";
import { basename, join } from "path";
import { parse as parseToml } from "smol-toml";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { DotDiff, recordUpstreamFetch } from "../git/services/DotDiff.js";
import { stow as runStow } from "./Stow.js";
import { agentsSync } from "./AgentsSync.js";
import { mcpSync } from "../mcp/commands/McpSync.js";
import { syncNotesRemotes } from "../git/notesRemote.js";
import { rebuild, restartDot } from "../lib/selfUpdate.js";
import { buildSkillsMaintenance } from "../lib/skillsMaintenance.js";
import { cloneMissingGitConfigRepos } from "../lib/privateGitRepos.js";
import { trustRepoMiseConfigs } from "../lib/miseTrust.js";
import { loadPrivatePackageRepoConfig } from "../doctor/checks/packages.js";
import { cliStyler } from "../lib/ansi.js";
import { plural } from "../lib/runSummary.js";
import {
  logRepoChanges,
  logUpdateSummary,
  writeUpdateSummary,
} from "../lib/updateSummary.js";
import {
  withSpinnerTimeout,
  withStepTimeout,
  withTimeoutOption,
} from "../lib/workflowStep.js";
import {
  hasLocalUpdateWork,
  pendingUpdateMaintenance,
} from "../lib/updateMaintenance.js";
import {
  ensureInitCompleteMarker,
  initCompleteMarker,
} from "../lib/initState.js";
import {
  gitHead,
  gitPullFastForward,
  gitRefreshRemoteHead,
  gitRequired,
} from "../lib/git.js";
import { HOME_DIR, displayPath } from "../lib/paths.js";
import { detectLegacyHyprRepo } from "../lib/omarchyHost.js";
import { ENV, envFlag } from "../lib/env.js";
import { loadDotGitConfig, managedGitRepos } from "../services/GitConfig.js";
import { setupPrivateRepo } from "./SetupPrivateRepo.js";
import type { ConfigService } from "../services/Config.js";
import type { GitManagedRepo } from "../services/GitConfig.js";
import type { InitCompleteMarkerStatus } from "../lib/initState.js";
import type { Styler } from "../lib/ansi.js";
import type {
  MiseToolChange,
  RecapEntry,
  UpdatedRepo,
} from "../lib/updateSummary.js";
import type { DiffRepo, RepoCategory } from "../types.js";

const DISABLE_SELF_UPDATE_ARG = "--no-self-update";

const POST_HOOK_REPO_ARG = "--post-hook-repo";

const STARTED_AT_ARG = "--started-at";

const SELECTABLE_UPDATE_FLAGS = [
  ["--pull", "pull"],
  ["--stow", "stow"],
  ["--app", "app"],
] as const;

/**
 * Concurrency for the background `git remote set-head --auto` refresh. Each call
 * hits the network per repo, so a small bound kicks several off at once without
 * spiking load while the pull stage runs alongside it.
 */
const REFRESH_REMOTE_HEAD_CONCURRENCY = 6;

/** Limit simultaneous pulls so slow remotes do not hold up unrelated repos. */
const REPO_PULL_CONCURRENCY = 8;

const LOCAL_HERDR_PLUGINS = [
  "terminal-title",
  "yazi",
  "repository-picker",
  "mise-task-runner",
  "plannotator",
] as const;

/**
 * Per-attempt bound for a single repo pull. A slow response is assumed to be
 * GitHub under load or a flaky local connection rather than something worth
 * waiting on, so this is deliberately short; the pull is retried once.
 */
const PULL_ATTEMPT_TIMEOUT_SECONDS = 30;

/** Upper bound for repository scans that include fetches. */
const REPO_SCAN_TIMEOUT_SECONDS = 60;

/** Attempts per repo: the initial pull plus one retry after a timeout. */
const PULL_MAX_ATTEMPTS = 2;

/** Upper bound (seconds) for each update step. */
const STEP_TIMEOUT_SECONDS = {
  pull: 8 * 60,
  stow: 3 * 60,
  miseInstall: 10 * 60,
  rebuild: 5 * 60,
  herdrPlugins: 5 * 60,
  postHooks: 2 * 60,
  uiReload: 60,
} as const;

/** Upper bound for one repository post-update command. */
const REPO_POST_UPDATE_TIMEOUT_SECONDS = 5 * 60;

/** Restore every nested submodule to the exact revision committed by its parent. */
export const updatePinnedSubmodules = (repoPath: string) =>
  gitRequired(["submodule", "update", "--init", "--recursive"], {
    cwd: repoPath,
  });

/** Options controlling which phases `dot update` runs. */
export interface UpdateOptions {
  /** Run the repository pull phase. */
  readonly pull?: boolean;
  /** Run the stow refresh phase. */
  readonly stow?: boolean;
  /** Run the dot app rebuild phase. */
  readonly app?: boolean;
  /** Run the initial self-update/restart phase before the selected phases. */
  readonly selfUpdate?: boolean;
  /** Reload the shell and run the UI resume refresh after applying changes. */
  readonly reload?: boolean;
  /** Repository names already pulled before restart, for post-hook handling. */
  readonly postHookRepos?: readonly string[];
  /** Write the final summary to this file instead of printing it. */
  readonly summaryFile?: string;
  /** Epoch ms the run started, carried across restart handoffs. */
  readonly startedAt?: number;
}

class UpdateError extends Schema.TaggedError<UpdateError>()("UpdateError", {
  message: Schema.String,
}) {}

function requiredUpdateStep<E, R>(
  label: string,
  seconds: number,
  step: Effect.Effect<void, E, R>,
): Effect.Effect<void, E | UpdateError, R | OutputLog> {
  return Effect.gen(function* () {
    if (!(yield* withStepTimeout(label, seconds, step))) {
      return yield* new UpdateError({
        message: `Update step timed out: ${label}`,
      });
    }
  });
}

const repoStatus = (repo: DiffRepo, style: Styler): string => {
  const parts: string[] = [];

  if (repo.isDirty) parts.push(style.warn(`${repo.modified} modified`));

  if (repo.ahead > 0) parts.push(style.accent(`${repo.ahead} ahead`));

  if (repo.behind > 0) parts.push(style.success(`${repo.behind} behind`));

  return parts.length > 0 ? parts.join(", ") : style.dim("up to date");
};

const reloadUiHelperPath = (): string => {
  return join(HOME_DIR, ".local", "bin", "reload-ui");
};

function logInitMarkerStatus(
  status: InitCompleteMarkerStatus,
  config: ConfigService,
): Effect.Effect<void, never, OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const marker = displayPath(initCompleteMarker(config));

    if (status === "created") {
      yield* log.info(`Init state complete: ${marker}`);

      return;
    }

    if (status === "exists") {
      yield* log.info(`Init state already complete: ${marker}`);

      return;
    }

    yield* log.info("Init state backfill skipped: init is in progress");
  });
}

/**
 * Safely pull a single repo, mirroring legacy `_git_clear_lock_and_pull`.
 *
 * Clears a stale `.git/index.lock` (skips if held by an active process),
 * and lets Git fast-forward only when local work can be preserved.
 * Returns the revisions before and after only if the pull moved HEAD.
 */
const safePull = (
  name: string,
  path: string,
  required = false,
  queued = false,
) =>
  Effect.gen(function* () {
    const log = yield* OutputLog;
    const executor = yield* CommandExecutor;
    const fs = yield* FileSystem.FileSystem;
    const style = cliStyler();

    // Clear a stale index lock; skip if held by a running git process.
    const lockFile = join(path, ".git", "index.lock");

    if (yield* fs.exists(lockFile).pipe(Effect.orDie)) {
      const held = yield* executor.exitCode("fuser", [lockFile]);

      if (held === 0) {
        yield* log.warn(
          `Lock held by active git process for ${name}: ${displayPath(path)}`,
        );
        yield* log.info(`Skipping ${name} pull (lock held)`);

        if (required)
          return yield* new UpdateError({ message: `${name}: Git lock held` });

        return null;
      }

      yield* log.warn(
        `Removing stale lock for ${name}: ${displayPath(lockFile)}`,
      );
      yield* fs.remove(lockFile).pipe(Effect.ignore);
    }

    const before = yield* gitHead(path).pipe(Effect.orElseSucceed(() => ""));

    yield* log.info(
      `Pulling ${style.accent(name)} ${style.dim(`(${displayPath(path)})`)}...`,
    );

    let pulled = false;

    for (let attempt = 1; attempt <= PULL_MAX_ATTEMPTS; attempt++) {
      const label = `Pulling ${name} (${attempt}/${PULL_MAX_ATTEMPTS}, timeout ${PULL_ATTEMPT_TIMEOUT_SECONDS}s)`;

      const outcome = yield* queued
        ? withTimeoutOption(
            gitPullFastForward(path),
            PULL_ATTEMPT_TIMEOUT_SECONDS,
          )
        : withSpinnerTimeout(
            label,
            PULL_ATTEMPT_TIMEOUT_SECONDS,
            gitPullFastForward(path),
          );

      if (Option.isSome(outcome)) {
        pulled = outcome.value;

        if (!pulled)
          yield* log.warn(`Pull failed or was refused for ${name}, skipping`);

        break;
      }

      if (attempt < PULL_MAX_ATTEMPTS) {
        yield* log.warn(
          `Pull timed out after ${PULL_ATTEMPT_TIMEOUT_SECONDS}s for ${name}, retrying (${attempt + 1}/${PULL_MAX_ATTEMPTS})...`,
        );
      } else {
        yield* log.warn(
          `Pull timed out for ${name} after ${PULL_MAX_ATTEMPTS} attempts, skipping`,
        );
      }
    }

    if (!pulled) {
      if (required)
        return yield* new UpdateError({
          message: `${name}: pull or submodule update failed`,
        });

      return null;
    }

    yield* recordUpstreamFetch(path);

    const after = yield* gitHead(path).pipe(Effect.orElseSucceed(() => ""));

    if (before === "" || after === "" || before === after) return null;

    yield* log.success(
      `Updated ${style.accent(name)} ${style.dim(`${before.slice(0, 7)} -> ${after.slice(0, 7)}`)}`,
    );

    return { from: before, to: after };
  });

/** Send a best-effort desktop notification for repos that pulled new changes */
const notifyUpdated = (names: readonly string[]) =>
  Effect.gen(function* () {
    if (names.length === 0) return;
    const executor = yield* CommandExecutor;

    const title = names.length === 1 ? "Git repo updated" : "Git repos updated";

    const message =
      names.length === 1
        ? `${names[0]} pulled new changes`
        : `${names.length} repos pulled new changes\n${names
            .map((n) => `- ${n}`)
            .join("\n")}`;

    yield* executor.exitCode("omarchy", [
      "notification",
      "send",
      "󰊢",
      title,
      message,
    ]);
  });

/** Run a repository's configured command after its pull moves HEAD. */
const runRepoPostUpdate = (repo: GitManagedRepo) =>
  Effect.gen(function* () {
    if (!repo.postUpdate) return;
    const command = repo.postUpdate;

    const log = yield* OutputLog;
    const executor = yield* CommandExecutor;
    yield* log.info(`Running ${repo.name} post-update command...`);

    const result = yield* withStepTimeout(
      `${repo.name} post-update`,
      REPO_POST_UPDATE_TIMEOUT_SECONDS,
      Effect.gen(function* () {
        const exitCode = yield* executor.inherit("sh", ["-c", command], {
          cwd: repo.path,
        });

        if (exitCode !== 0) {
          return yield* new UpdateError({
            message: `${repo.name} post-update command exited ${exitCode}`,
          });
        }
      }),
    );

    if (!result) {
      return yield* new UpdateError({
        message: `${repo.name} post-update command timed out`,
      });
    }

    yield* log.success(`${repo.name} post-update command complete`);
  });

/**
 * Pull selected repositories and run their hooks. Unless `pullOnly` is set,
 * also apply changed dotfiles once.
 */
export const updateRepositories = Effect.fn("Update.repositories")(function* (
  paths: readonly string[],
  reload = true,
  pullOnly = false,
) {
  const config = yield* Config;
  const fs = yield* FileSystem.FileSystem;
  const log = yield* OutputLog;
  const startedAt = yield* Clock.currentTimeMillis;
  const updatedNames: string[] = [];
  const updatedPaths = new Set<string>();
  const failures: string[] = [];
  const pulledDotfiles: string[] = [];
  const managed = managedGitRepos(config.gitConfig);
  const publicPath = yield* fs.realPath(config.publicDotfiles);

  const privatePath = config.privateDotfiles
    ? yield* fs.realPath(config.privateDotfiles)
    : null;

  const uniquePaths = [...new Set(paths)];

  const results = yield* Effect.forEach(
    uniquePaths,
    (path) =>
      Effect.gen(function* () {
        const repoPath = yield* fs.realPath(path);
        const repo = managed.find((entry) => entry.path === repoPath);
        const name = repo?.name ?? basename(repoPath);

        const range = yield* safePull(
          name,
          repoPath,
          true,
          uniquePaths.length > 1,
        );

        if (!range) return null;

        return { name, repoPath, range };
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const message = `${displayPath(path)}: ${error.message}`;
            failures.push(message);
            yield* log.error(message);

            return null;
          }),
        ),
      ),
    { concurrency: REPO_PULL_CONCURRENCY },
  );

  for (const result of results) {
    if (!result) continue;
    updatedNames.push(result.name);
    updatedPaths.add(result.repoPath);

    if (result.repoPath === publicPath || result.repoPath === privatePath)
      pulledDotfiles.push(basename(result.repoPath));
  }

  const restartsForDotfiles = !pullOnly && pulledDotfiles.length > 0;

  // The restarted update summarises pulled dotfiles itself.
  yield* logRepoChanges(
    results.flatMap((result) =>
      result &&
      !(
        restartsForDotfiles &&
        (result.repoPath === publicPath || result.repoPath === privatePath)
      )
        ? [{ name: result.name, path: result.repoPath, ...result.range }]
        : [],
    ),
  );

  if (updatedPaths.size > 0) {
    const gitConfig = config.canUsePrivate
      ? yield* loadDotGitConfig(config.gitConfig.filePath)
      : config.gitConfig;

    for (const repo of managedGitRepos(gitConfig)) {
      if (!updatedPaths.has(repo.path)) continue;
      yield* runRepoPostUpdate(repo).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            failures.push(error.message);
            yield* log.error(error.message);
          }),
        ),
      );
    }
  }

  if (restartsForDotfiles) {
    yield* requiredUpdateStep("Rebuild", STEP_TIMEOUT_SECONDS.rebuild, rebuild);
    yield* restartDot([
      "update",
      "--stow",
      "--app",
      ...(reload ? [] : ["--no-reload"]),
      ...pulledDotfiles.flatMap((name) => [POST_HOOK_REPO_ARG, name]),
      STARTED_AT_ARG,
      String(startedAt),
    ]);
  } else {
    yield* notifyUpdated(updatedNames);
  }

  if (failures.length > 0)
    return yield* new UpdateError({ message: failures.join("\n") });
});

function selectedUpdateFlags(opts?: UpdateOptions): readonly string[] {
  return SELECTABLE_UPDATE_FLAGS.flatMap(([flag, key]) =>
    opts?.[key] ? [flag] : [],
  );
}

/** Resolve repositories pulled before a restart, compared through `ORIG_HEAD`. */
function restartedUpdatedRepos(
  config: ConfigService,
  names: readonly string[],
): UpdatedRepo[] {
  const managed = managedGitRepos(config.gitConfig);

  return names.flatMap((name) => {
    const path =
      name === basename(config.publicDotfiles)
        ? config.publicDotfiles
        : config.privateDotfiles && name === basename(config.privateDotfiles)
          ? config.privateDotfiles
          : managed.find((repo) => repo.name === name)?.path;

    return path ? [{ name, path, from: "ORIG_HEAD", to: "HEAD" }] : [];
  });
}

function restartUpdateArgs(
  opts: UpdateOptions | undefined,
  ...pulledRepoNames: readonly string[]
): readonly string[] {
  return [
    "update",
    ...selectedUpdateFlags(opts),
    DISABLE_SELF_UPDATE_ARG,
    ...(opts?.reload === false ? ["--no-reload"] : []),
    ...(opts?.postHookRepos ?? []).flatMap((name) => [
      POST_HOOK_REPO_ARG,
      name,
    ]),
    ...pulledRepoNames.flatMap((name) => [POST_HOOK_REPO_ARG, name]),
    ...(opts?.summaryFile ? ["--summary-file", opts.summaryFile] : []),
    ...(opts?.startedAt === undefined
      ? []
      : [STARTED_AT_ARG, String(opts.startedAt)]),
  ];
}

/**
 * Pull public (and optionally private) dotfiles together, then restart when
 * either moved. Public changes rebuild dot before the restart.
 */
function selfUpdateAndRestart(
  config: ConfigService,
  opts: UpdateOptions | undefined,
  pullPrivate: boolean,
) {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    yield* log.section("Self Update");
    const repoName = basename(config.publicDotfiles);
    const privateDotfiles = pullPrivate ? config.privateDotfiles : undefined;
    const privateName = privateDotfiles ? basename(privateDotfiles) : "";

    const [moved, privateMoved] = yield* Effect.all(
      [
        safePull(repoName, config.publicDotfiles, false, !!privateDotfiles),
        privateDotfiles
          ? safePull(privateName, privateDotfiles, false, true)
          : Effect.succeed(null),
      ],
      { concurrency: 2 },
    );

    const privateRestartNames = privateMoved ? [privateName] : [];

    if (!moved) {
      if (privateMoved) {
        yield* log.info("Restarting update to reload private configuration");
        yield* restartDot(restartUpdateArgs(opts, ...privateRestartNames));

        return { restarted: true, privatePulled: true };
      }

      yield* log.info("No dotfiles changes; continuing without a rebuild");

      return { restarted: false, privatePulled: !!privateDotfiles };
    }

    const rebuilt = yield* withStepTimeout(
      "Rebuild",
      STEP_TIMEOUT_SECONDS.rebuild,
      rebuild,
    );

    if (!rebuilt) {
      return yield* new UpdateError({
        message: "Update step timed out: Self Update Rebuild",
      });
    }

    yield* log.success("Self update successful");
    yield* log.info("Restarting update with rebuilt dot binary");
    yield* restartDot(
      restartUpdateArgs(opts, repoName, ...privateRestartNames),
    );

    return { restarted: true, privatePulled: true };
  });
}

/** Run post-update hooks. */
const postHooks = Effect.gen(function* () {
  const log = yield* OutputLog;

  yield* log.section("Post-Hooks");

  yield* agentsSync;
});

const done = (message: string): RecapEntry => ({ status: "done", message });

const skip = (message: string): RecapEntry => ({ status: "skip", message });

const warn = (message: string): RecapEntry => ({ status: "warn", message });

const MiseToolVersions = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Array(Schema.Struct({ version: Schema.String })),
  ),
);

/** Read `mise ls <flag> --json` from the home directory. */
const miseToolVersions = Effect.fn("miseToolVersions")(function* (
  flag: "--missing" | "--installed",
) {
  const executor = yield* CommandExecutor;

  return yield* executor
    .run("mise", ["ls", flag, "--json"], { cwd: HOME_DIR })
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(MiseToolVersions)));
});

/**
 * List missing home-level mise tools with the newest version already installed
 * for each, or none if they cannot be read.
 */
const listMissingMiseTools = Effect.gen(function* () {
  const missing = yield* miseToolVersions("--missing");
  const installed = yield* miseToolVersions("--installed");

  return Object.entries(missing).flatMap(([tool, versions]) => {
    // mise lists installed versions oldest first.
    const previous = installed[tool]?.at(-1)?.version;

    return versions.map(({ version }): MiseToolChange =>
      previous
        ? { change: "updated", tool, version, previous }
        : { change: "installed", tool, version },
    );
  });
}).pipe(Effect.orElseSucceed((): readonly MiseToolChange[] => []));

/**
 * Install missing home-level mise tools after checking with mise. Returns the
 * installed tools when an install ran (empty if they could not be listed).
 */
const installMissingMiseTools = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  yield* log.section("Install Mise Tools");

  if ((yield* executor.exitCode("which", ["mise"])) !== 0) {
    yield* log.warn("Skipping mise install (mise not installed)");

    return Option.none();
  }

  const checkExitCode = yield* executor.exitCode(
    "mise",
    ["install", "--dry-run-code"],
    { cwd: HOME_DIR },
  );

  if (checkExitCode === 0) {
    yield* log.info(
      "All global mise tools are installed; skipping mise install",
    );

    return Option.none();
  }

  if (checkExitCode !== 1) {
    return yield* new UpdateError({
      message: `mise install check exited ${checkExitCode}`,
    });
  }

  const tools = yield* listMissingMiseTools;

  const exitCode = yield* executor.inherit("mise", ["install"], {
    cwd: HOME_DIR,
  });

  if (exitCode !== 0) {
    return yield* new UpdateError({
      message: `mise install exited ${exitCode}`,
    });
  }

  return Option.some(tools);
});

const MiseConfigTools = Schema.Struct({
  tools: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

const MiseToolNames = Schema.fromJsonString(Schema.Array(Schema.String));

/** Tool names in the global mise config, or none if it cannot be read. */
const readMiseConfigTools = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs
    .readFileString(join(HOME_DIR, ".config", "mise", "config.toml"))
    .pipe(
      Effect.flatMap((text) => Effect.try(() => parseToml(text))),
      Effect.flatMap(Schema.decodeUnknownEffect(MiseConfigTools)),
      Effect.map((config) => Object.keys(config.tools ?? {})),
      Effect.option,
    );
});

/**
 * Prune every installed version of tools removed from the global mise config
 * since the last run, tracked in a snapshot of its tool names. mise keeps
 * versions still used by other tracked configs. Returns the pruned versions.
 */
const pruneRemovedMiseTools = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* Config;
  const snapshotPath = join(config.stateDir, "mise-tools.json");

  const current = yield* readMiseConfigTools;

  if (Option.isNone(current)) return [];

  const previous = yield* fs.readFileString(snapshotPath).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(MiseToolNames)),
    Effect.orElseSucceed((): readonly string[] => current.value),
  );

  const saveSnapshot = fs
    .writeFileString(snapshotPath, JSON.stringify(current.value))
    .pipe(Effect.ignore);

  const removed = previous.filter((tool) => !current.value.includes(tool));

  if (removed.length === 0) {
    yield* saveSnapshot;

    return [];
  }

  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  yield* log.section("Prune Mise Tools");
  yield* log.info(`Removed from the global mise config: ${removed.join(", ")}`);

  const installedVersions = miseToolVersions("--installed").pipe(
    Effect.orElseSucceed((): typeof MiseToolVersions.Type => ({})),
  );

  const before = yield* installedVersions;

  const exitCode = yield* executor.inherit(
    "mise",
    ["prune", "--tools", "--yes", ...removed],
    { cwd: HOME_DIR },
  );

  if (exitCode !== 0) {
    return yield* new UpdateError({
      message: `mise prune exited ${exitCode}`,
    });
  }

  const after = yield* installedVersions;
  yield* saveSnapshot;

  return removed.flatMap((tool) =>
    (before[tool] ?? [])
      .filter(
        ({ version }) => !after[tool]?.some((kept) => kept.version === version),
      )
      .map(({ version }): MiseToolChange => ({
        change: "removed",
        tool,
        version,
      })),
  );
});

/** Read the Herdr Lazy plugin root from `herdr plugin list --json`. */
export function herdrLazyPluginRoot(source: string): string | null {
  try {
    const parsed = Schema.decodeUnknownSync(
      Schema.Struct({
        result: Schema.Struct({
          plugins: Schema.Array(
            Schema.Struct({
              plugin_id: Schema.String,
              plugin_root: Schema.optional(Schema.String),
            }),
          ),
        }),
      }),
    )(JSON.parse(source));

    return (
      parsed.result.plugins.find(({ plugin_id }) => plugin_id === "herdr-lazy")
        ?.plugin_root ?? null
    );
  } catch {
    return null;
  }
}

/** Whether session-bound Herdr actions can target the calling pane. */
export function canRunHerdrSessionActions(): boolean {
  return envFlag(ENV.HERDR_ENV);
}

/** Restore Herdr plugins to the commits in the stowed Herdr Lazy lockfile. */
const restoreHerdrPlugins = Effect.gen(function* () {
  const log = yield* OutputLog;
  const executor = yield* CommandExecutor;
  const config = yield* Config;
  const fs = yield* FileSystem.FileSystem;

  yield* log.section("Herdr Plugins");

  if (!canRunHerdrSessionActions()) {
    yield* log.info("Skipping Herdr plugins (outside Herdr)");

    return;
  }

  const pluginList = yield* executor
    .run("herdr", ["plugin", "list", "--json"])
    .pipe(Effect.orElseSucceed(() => null));

  if (pluginList === null) {
    yield* log.warn("Skipping Herdr plugins (Herdr is unavailable)");

    return;
  }

  let pluginRoot = herdrLazyPluginRoot(pluginList);

  if (!pluginRoot) {
    yield* log.info("Installing Herdr Lazy");

    const installExitCode = yield* executor.inherit("herdr", [
      "plugin",
      "install",
      "natori-hrj/herdr-lazy",
      "--yes",
    ]);

    if (installExitCode !== 0) {
      return yield* new UpdateError({
        message: `Herdr Lazy install exited ${installExitCode}`,
      });
    }

    const installedPluginList = yield* executor.run("herdr", [
      "plugin",
      "list",
      "--json",
    ]);

    pluginRoot = herdrLazyPluginRoot(installedPluginList);

    if (!pluginRoot) {
      return yield* new UpdateError({
        message: "Herdr Lazy is missing after installation",
      });
    }
  }

  const binary = join(pluginRoot, "target", "release", "herdr-lazy");

  if (!(yield* fs.exists(binary).pipe(Effect.orDie))) {
    yield* log.warn("Skipping Herdr plugins (Herdr Lazy binary is missing)");

    return;
  }

  const exitCode = yield* executor.inherit(binary, ["restore"]);

  if (exitCode !== 0) {
    return yield* new UpdateError({
      message: `Herdr plugin restore exited ${exitCode}`,
    });
  }

  yield* log.success("Herdr plugins restored from lockfile");

  for (const plugin of LOCAL_HERDR_PLUGINS) {
    const pluginRoot = join(
      config.publicDotfiles,
      "scripts",
      ".local",
      "share",
      "herdr-plugins",
      plugin,
    );

    const linkExitCode = yield* executor.inherit("herdr", [
      "plugin",
      "link",
      pluginRoot,
      "--enabled",
    ]);

    if (linkExitCode !== 0) {
      return yield* new UpdateError({
        message: `Herdr local plugin ${plugin} link exited ${linkExitCode}`,
      });
    }
  }

  const titleWatcherExitCode = yield* executor.inherit("herdr", [
    "plugin",
    "action",
    "invoke",
    "start",
    "--plugin",
    "dotfiles.terminal-title",
  ]);

  if (titleWatcherExitCode !== 0) {
    return yield* new UpdateError({
      message: `Herdr terminal title watcher exited ${titleWatcherExitCode}`,
    });
  }

  yield* log.success("Herdr local plugins linked");
});

/** Reload the UI so status-bar services pick up update changes. */
const runUiReload = Effect.gen(function* () {
  const log = yield* OutputLog;
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const helper = reloadUiHelperPath();

  yield* log.section("Reload UI");

  if (!(yield* fs.exists(helper).pipe(Effect.orDie))) {
    yield* log.warn("Skipping reload-ui helper (not installed)");

    return;
  }

  const exitCode = yield* executor.exitCode(helper, ["--no-auto-open"]);

  if (exitCode !== 0) {
    yield* log.warn(`Reload UI helper failed (exit ${exitCode})`);

    return;
  }

  yield* log.success("On-resume helper started");
});

/**
 * Reload the running Omarchy shell after its generated `shell.json` changed.
 *
 * Restarts the shell so it reloads the generated layout and discovers any new
 * plugins. Runs `omarchy` via the dispatcher and forces `QT_QPA_PLATFORM=wayland` on the
 * restart so the relaunched shell attaches its layer-shell bar even when
 * `dot update` is triggered from an environment that defaults to `xcb` (an SSH
 * session, a systemd unit, or an agent shell); launching the shell under XCB
 * silently drops the bar. `omarchy restart shell` refuses while the session is
 * locked, which is treated as a non-fatal skip. No-op when Omarchy is disabled.
 */
const reloadOmarchyShell = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;
  const executor = yield* CommandExecutor;

  if (!config.omarchy.enabled) return;

  yield* log.section("Reload Shell");

  const exitCode = yield* executor.exitCode("omarchy", ["restart", "shell"], {
    env: { QT_QPA_PLATFORM: "wayland" },
  });

  if (exitCode !== 0) {
    yield* log.warn(
      `Shell reload skipped or failed (exit ${exitCode}; session may be locked)`,
    );

    return;
  }

  yield* log.success("Reloaded Omarchy shell (shell.json changed)");
});

/** Reload the Omarchy shell only when stow rewrote its generated config. */
export function reloadOmarchyShellIfChanged(
  shellConfigChanged: boolean,
): Effect.Effect<void, never, Config | OutputLog | CommandExecutor> {
  return shellConfigChanged ? reloadOmarchyShell : Effect.void;
}

/** Exit code from `dot update --check` when in-scope updates are available. */
export const UPDATE_CHECK_AVAILABLE_EXIT = 10;

/** Exit code from `dot update --check` when the repo scan could not complete. */
export const UPDATE_CHECK_ERROR_EXIT = 2;

/** Repo categories treated as "core/system" by `dot update --check`. */
const CORE_CHECK_CATEGORIES: ReadonlySet<RepoCategory> = new Set([
  "dotfiles",
  "omarchy",
]);

/** Options controlling `dot update --check`. */
export interface UpdateCheckOptions {
  /** Also report upstream changes in development repositories. */
  readonly all?: boolean;
}

/**
 * Report actionable pulls and unapplied dotfiles maintenance without changing files.
 *
 * Scans repos via {@link DotDiff} (TTL-cached fetch). By default only
 * core/system repos (dotfiles + omarchy) are considered; `all` widens the
 * scope to every tracked repo. Repositories with local work are skipped.
 * Returns {@link UPDATE_CHECK_AVAILABLE_EXIT} for actionable pulls or maintenance,
 * {@link UPDATE_CHECK_ERROR_EXIT} when checks fail without finding an update,
 * and 0 when no updates need applying.
 */
export const updateCheck = (opts?: UpdateCheckOptions) =>
  Effect.gen(function* () {
    const log = yield* OutputLog;
    const dotDiff = yield* DotDiff;

    const scopeRepos = opts?.all ? "tracked repos" : "core/system repos";
    yield* log.section("Update Check");

    const scanned = yield* withSpinnerTimeout(
      "Checking repositories",
      REPO_SCAN_TIMEOUT_SECONDS,
      dotDiff
        .getAll(opts?.all ? undefined : { categories: CORE_CHECK_CATEGORIES })
        .pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              yield* log.error(`Update check failed: ${error.message}`);

              return null;
            }),
          ),
        ),
    );

    const repos = yield* Option.match(scanned, {
      onNone: () =>
        Effect.gen(function* () {
          yield* log.error(
            `Update check timed out after ${REPO_SCAN_TIMEOUT_SECONDS}s`,
          );

          return null;
        }),
      onSome: (value) => Effect.succeed(value),
    });

    if (repos === null) {
      yield* Effect.sync(() => {
        process.exitCode = UPDATE_CHECK_ERROR_EXIT;
      });

      return;
    }

    const scoped = opts?.all
      ? repos
      : repos.filter((repo) => CORE_CHECK_CATEGORIES.has(repo.category));

    yield* log.info(
      `Checked ${scoped.length} ${scopeRepos}: ${scoped
        .map((repo) => repo.name)
        .join(", ")}`,
    );
    const pending: string[] = [];
    let failed = false;

    for (const repo of scoped) {
      yield* Effect.gen(function* () {
        if (yield* hasLocalUpdateWork(repo)) {
          yield* log.info(`Skipping ${repo.name} (local work)`);

          return;
        }

        if (repo.behind > 0)
          pending.push(`${repo.name}: ${repo.behind} behind`);

        if (CORE_CHECK_CATEGORIES.has(repo.category)) {
          pending.push(...(yield* pendingUpdateMaintenance(repo)));
        }
      }).pipe(
        Effect.timeout(`${REPO_SCAN_TIMEOUT_SECONDS} seconds`),
        Effect.catch((error) =>
          Effect.gen(function* () {
            failed = true;
            yield* log.error(`Could not check ${repo.name}: ${error.message}`);
          }),
        ),
      );
    }

    if (pending.length === 0) {
      if (failed) {
        yield* Effect.sync(() => {
          process.exitCode = UPDATE_CHECK_ERROR_EXIT;
        });
      } else {
        yield* log.info(`No updates needed for ${scopeRepos}`);
      }

      return;
    }

    yield* log.info(`${pending.length} pending updates:`);

    for (const item of pending) {
      yield* log.info(`  ${item}`);
    }

    yield* log.info("Run `dot update` to apply.");
    yield* Effect.sync(() => {
      process.exitCode = UPDATE_CHECK_AVAILABLE_EXIT;
    });
  });

/** Exit code from `dot update` when a machine still needs the Hypr migration. */
export const MIGRATION_REQUIRED_EXIT = 11;

/**
 * Halt the update when `~/.config/hypr` is still the retired omarchy-hypr clone.
 *
 * The Hypr config is now a stowed dotfiles package. A machine still tracking
 * the external clone must back it up before stow can take over, so this stops
 * the pull/stow phases, prints manual remediation, and sets a non-zero exit.
 * Returns true when the update should halt.
 */
const haltOnLegacyHyprRepo = (config: ConfigService) =>
  Effect.gen(function* () {
    const legacy = yield* detectLegacyHyprRepo(config);

    if (!legacy.present) return false;

    const log = yield* OutputLog;
    const path = displayPath(legacy.repoPath);
    yield* log.section("Migration Required");
    yield* log.error(`Legacy omarchy-hypr clone present at ${path}`);
    yield* log.error(
      "Hypr config is now a stowed dotfiles package — update halted.",
    );
    yield* log.info("Resolve on this machine, then re-run dot update:");
    yield* log.info(`  mv ${path} ${path}.bak`);
    yield* log.info("  dot stow --public");
    yield* log.info(`  cp -a ${path}.bak/shaders ${path}/`);
    yield* Effect.sync(() => {
      process.exitCode = MIGRATION_REQUIRED_EXIT;
    });

    return true;
  });

/**
 * Run `dot update`: self-update, pull behind repos, restow dotfiles, rebuild.
 *
 * Flags are inclusive — passing any of pull/stow/app selects only those
 * steps; if none are set, all three run (legacy semantics).
 *
 * The pull phase first updates private dotfiles and restarts if they changed,
 * so cloning and stow use the refreshed configuration. It then fetch-scans
 * every tracked repo (public, private, notes,
 * omarchy + worktrees, schedule-gated extras) via {@link DotDiff} and only
 * pulls repos that are behind upstream. It then marks any mise config files in
 * the tracked repos as trusted (best-effort) so `mise` never prompts for them
 * on this machine. Full updates pull public and private dotfiles together
 * first; when the public pull moves HEAD they rebuild and restart without
 * self-update, and the restarted run skips the final rebuild. Repositories
 * pulled earlier in the run are not fetched again by the scan.
 * Pull notifications fire only when a repo actually moved, while post-hooks
 * (agents-sync) run on every full update and the changed-dotfiles handoff.
 * Ordinary flag-scoped runs skip them.
 */
export const update = (updateOpts?: UpdateOptions) =>
  Effect.gen(function* () {
    const startedAt = updateOpts?.startedAt ?? (yield* Clock.currentTimeMillis);

    const opts: UpdateOptions = { ...updateOpts, startedAt };

    const anyFlag = !!(opts.pull || opts.stow || opts.app);
    const doPull = anyFlag ? !!opts?.pull : true;
    const doStow = anyFlag ? !!opts?.stow : true;
    const doApp = anyFlag ? !!opts?.app : true;
    const isFullUpdate = anyFlag ? doPull && doStow && doApp : true;

    const config = yield* Config;
    const log = yield* OutputLog;

    const applyPulledDotfiles =
      doStow &&
      doApp &&
      opts?.postHookRepos?.some(
        (name) =>
          name === basename(config.publicDotfiles) ||
          (config.privateDotfiles !== null &&
            name === basename(config.privateDotfiles)),
      );

    const privatePackageRepo = config.canUsePrivate
      ? yield* loadPrivatePackageRepoConfig(config)
      : null;

    // Every handoff that names public dotfiles rebuilt dot from that pull first.
    let dotRebuilt =
      opts?.postHookRepos?.includes(basename(config.publicDotfiles)) ?? false;

    yield* log.section("Update Workflow");

    let privatePulled = false;

    if (isFullUpdate && opts?.selfUpdate !== false) {
      const selfUpdate = yield* selfUpdateAndRestart(config, opts, doPull);

      if (selfUpdate.restarted) return;
      privatePulled = selfUpdate.privatePulled;
    }

    // Migration halt: a machine still on the retired omarchy-hypr clone must
    // back it up before stow can take over. Runs after the self-update restart
    // so the rebuilt binary (carrying this guard) performs the check, halting
    // the first phase until the legacy repo is resolved.
    if (doPull || doStow) {
      const halted = yield* haltOnLegacyHyprRepo(config);

      if (halted) return;
    }

    if (
      doPull &&
      config.privateDotfiles &&
      !privatePulled &&
      !opts?.postHookRepos?.includes(basename(config.privateDotfiles))
    ) {
      const repoName = basename(config.privateDotfiles);
      const moved = yield* safePull(repoName, config.privateDotfiles);

      if (moved) {
        yield* log.info("Restarting update to reload private configuration");
        yield* restartDot(restartUpdateArgs(opts, repoName));

        return;
      }
    }

    const updatedRepos = restartedUpdatedRepos(
      config,
      opts?.postHookRepos ?? [],
    );

    const completedActions: RecapEntry[] = [];
    const miseToolChanges: MiseToolChange[] = [];
    let privatePackageRepoUpdated = false;
    const pullRecap: RecapEntry[] = [];

    if (doPull) {
      yield* requiredUpdateStep(
        "Pull Repositories",
        STEP_TIMEOUT_SECONDS.pull,
        Effect.gen(function* () {
          yield* log.section("Pull Repositories");
          const cloned = yield* cloneMissingGitConfigRepos({ strict: false });
          yield* trustRepoMiseConfigs(cloned);

          const dotDiff = yield* DotDiff;

          const scanned = yield* withSpinnerTimeout(
            "Scanning repositories",
            REPO_SCAN_TIMEOUT_SECONDS,
            dotDiff.getAll(),
          );

          const repos = yield* Option.match(scanned, {
            onNone: () =>
              new UpdateError({
                message: `Repository scan timed out after ${REPO_SCAN_TIMEOUT_SECONDS}s`,
              }),
            onSome: (value) => Effect.succeed(value),
          });

          const style = cliStyler();

          for (const repo of repos) {
            yield* log.info(
              `${style.label(repo.name)}: ${repoStatus(repo, style)} ${style.dim(`(${displayPath(repo.path)})`)}`,
            );
          }

          // Race the best-effort branch refresh against the pull: whichever finishes
          // first, the update continues. `git remote set-head --auto` re-points each
          // repo's local <remote>/HEAD at the remote default branch (so a rename does
          // not mislead default-branch detection in context git), but it hits the
          // network per repo and can hang
          // on a slow remote. Rather than block on it, we fork it into this scope and
          // let the pull below be the spine: when the pull finishes the scope closes
          // and any still-running refresh is interrupted. This is safe because the
          // refresh is purely cosmetic, the origin/HEAD doctor check catches any
          // staleness, and set-head calls already spawned still complete in the
          // background.
          yield* Effect.scoped(
            Effect.gen(function* () {
              yield* Effect.forEach(
                repos,
                (repo) => gitRefreshRemoteHead(repo.path),
                { discard: true, concurrency: REFRESH_REMOTE_HEAD_CONCURRENCY },
              ).pipe(
                Effect.andThen(log.success("Refreshed remote branches")),
                Effect.forkScoped,
              );

              if (!config.canUsePrivate) {
                yield* log.warn(
                  `Skipping private pull (${config.privateReason})`,
                );
                pullRecap.push(
                  skip(`Private pull skipped (${config.privateReason})`),
                );
              }

              const changed = repos.filter(
                (r) => r.isDirty || r.ahead > 0 || r.behind > 0,
              );

              // Private dotfiles were already pulled before loading this repo list.
              const behind = repos.filter(
                (r) => r.behind > 0 && r.path !== config.privateDotfiles,
              );

              if (behind.length === 0) {
                if (changed.length > 0) {
                  yield* log.info("Nothing to pull (no repos behind upstream)");

                  const notes: string[] = [];

                  if (changed.some((r) => r.isDirty))
                    notes.push("dirty working tree");

                  if (changed.some((r) => r.ahead > 0))
                    notes.push("ahead of upstream");
                  yield* log.warn(
                    `${plural(changed.length, "repository", "repositories")} need attention: ${notes.join(", ")}`,
                  );

                  for (const repo of changed) {
                    yield* log.warn(
                      `  - ${repo.name}: ${displayPath(repo.path)}`,
                    );
                  }

                  for (const repo of changed) {
                    const reasons = [
                      repo.isDirty ? "dirty working tree" : "",
                      repo.ahead > 0 ? "ahead of upstream" : "",
                    ].filter(Boolean);

                    pullRecap.push(
                      warn(
                        `${repo.name} needs attention: ${reasons.join(", ")}`,
                      ),
                    );
                  }
                } else {
                  yield* log.success("All repositories are up to date");
                }
              } else {
                yield* log.info(
                  `${plural(changed.length, "repository", "repositories")} need attention`,
                );

                const pulled = yield* Effect.forEach(
                  behind,
                  (repo) =>
                    safePull(repo.name, repo.path, false, true).pipe(
                      Effect.map((range) => ({ repo, range })),
                    ),
                  { concurrency: REPO_PULL_CONCURRENCY },
                );

                for (const { repo, range } of pulled) {
                  if (!range) {
                    pullRecap.push(
                      warn(
                        `${repo.name} is behind upstream but was not pulled${repo.isDirty ? " (dirty working tree)" : ""}`,
                      ),
                    );
                    continue;
                  }

                  updatedRepos.push({
                    name: repo.name,
                    path: repo.path,
                    ...range,
                  });

                  if (repo.path === privatePackageRepo?.path)
                    privatePackageRepoUpdated = true;

                  if (repo.path === config.publicDotfiles) dotRebuilt = false;
                }
              }

              yield* log.info("Updating pinned submodules");
              yield* updatePinnedSubmodules(config.publicDotfiles);

              if (config.privateDotfiles)
                yield* updatePinnedSubmodules(config.privateDotfiles);
            }),
          );

          const updated = new Set(updatedRepos.map((repo) => repo.name));

          for (const repo of managedGitRepos(config.gitConfig)) {
            if (updated.has(repo.name)) yield* runRepoPostUpdate(repo);
          }

          if (privatePackageRepoUpdated) {
            yield* setupPrivateRepo;
          }
        }),
      );

      const pulledNames = [...new Set(updatedRepos.map((repo) => repo.name))];

      completedActions.push(
        pulledNames.length > 0
          ? done(
              `Pulled ${plural(pulledNames.length, "repository", "repositories")}: ${pulledNames.join(", ")}`,
            )
          : skip("No repositories pulled (nothing new upstream)"),
        ...pullRecap,
      );
    }

    let shellConfigChanged = false;

    if (doStow || doApp) {
      yield* requiredUpdateStep(
        "Build Skill Maintenance",
        STEP_TIMEOUT_SECONDS.rebuild,
        Effect.gen(function* () {
          yield* log.section("Skill Maintenance");
          const { target, built } = yield* buildSkillsMaintenance;

          yield* built
            ? log.info(`Built ${displayPath(target)}`)
            : log.info(
                `${displayPath(target)} is already built from this source`,
              );

          completedActions.push(
            built
              ? done("Rebuilt the skill-maintenance executable")
              : skip("Skill-maintenance executable already built"),
          );
        }),
      );
    }

    if (doStow) {
      yield* requiredUpdateStep(
        "Stow",
        STEP_TIMEOUT_SECONDS.stow,
        Effect.gen(function* () {
          yield* mcpSync;
          yield* syncNotesRemotes;

          const result = yield* runStow();
          shellConfigChanged = result.shellConfigChanged;
          completedActions.push(
            done("Synced MCP config"),
            ...result.actions.map(done),
          );
        }),
      );
    }

    if (doPull || doStow) {
      yield* requiredUpdateStep(
        "Install Mise Tools",
        STEP_TIMEOUT_SECONDS.miseInstall,
        installMissingMiseTools.pipe(
          Effect.map((installed) => {
            if (Option.isNone(installed)) {
              completedActions.push(skip("No mise tools to install"));

              return;
            }

            miseToolChanges.push(...installed.value);
            completedActions.push(
              installed.value.length > 0
                ? done(
                    `Installed ${plural(installed.value.length, "mise tool")}`,
                  )
                : skip("No mise tools to install"),
            );
          }),
        ),
      );

      yield* requiredUpdateStep(
        "Prune Mise Tools",
        STEP_TIMEOUT_SECONDS.miseInstall,
        pruneRemovedMiseTools.pipe(
          Effect.map((pruned) => {
            if (pruned.length === 0) {
              completedActions.push(skip("No mise tools to prune"));

              return;
            }

            miseToolChanges.push(...pruned);
            completedActions.push(
              done(`Pruned ${plural(pruned.length, "mise tool version")}`),
            );
          }),
        ),
      );
    }

    if (opts?.reload !== false) {
      yield* reloadOmarchyShellIfChanged(shellConfigChanged);

      if (shellConfigChanged) {
        completedActions.push(done("Attempted an Omarchy shell reload"));
      }
    }

    if (doApp && !dotRebuilt) {
      let built = true;

      yield* requiredUpdateStep(
        "Rebuild",
        STEP_TIMEOUT_SECONDS.rebuild,
        Effect.gen(function* () {
          yield* log.section("Rebuild");
          built = yield* rebuild;

          yield* built
            ? log.success("Build successful")
            : log.info("dot binary is already built from this source");
        }),
      );

      completedActions.push(
        built
          ? done("Rebuilt the dot binary")
          : skip("dot binary already built from this source"),
      );
    } else if (doApp) {
      completedActions.push(done("Rebuilt the dot binary before restarting"));
    }

    if (isFullUpdate || applyPulledDotfiles) {
      yield* requiredUpdateStep(
        "Herdr Plugins",
        STEP_TIMEOUT_SECONDS.herdrPlugins,
        restoreHerdrPlugins,
      );
      completedActions.push(done("Ran the Herdr plugin refresh phase"));
    }

    // Notify only when a repo actually moved.
    if (updatedRepos.length > 0) {
      yield* notifyUpdated(updatedRepos.map((repo) => repo.name));
    }

    // Full updates and the changed-dotfiles handoff sync agent instructions.
    if (isFullUpdate || applyPulledDotfiles) {
      yield* requiredUpdateStep(
        "Post-Hooks",
        STEP_TIMEOUT_SECONDS.postHooks,
        postHooks,
      );
      completedActions.push(done("Synced agent instructions"));
    }

    if (isFullUpdate) {
      const markerStatus = yield* ensureInitCompleteMarker(config, "update");
      yield* logInitMarkerStatus(markerStatus, config);
      completedActions.push(done("Checked the init state marker"));
    }

    if (opts?.reload !== false) {
      const uiRefreshCompleted = yield* withStepTimeout(
        "Reload UI",
        STEP_TIMEOUT_SECONDS.uiReload,
        runUiReload,
      );

      if (uiRefreshCompleted) {
        completedActions.push(done("Completed the UI resume refresh step"));
      }
    }

    yield* opts.summaryFile
      ? writeUpdateSummary(
          opts.summaryFile,
          updatedRepos,
          miseToolChanges,
          completedActions,
          startedAt,
        )
      : logUpdateSummary(
          updatedRepos,
          miseToolChanges,
          completedActions,
          startedAt,
        );

    yield* log.section("Update Status");
    const executor = yield* CommandExecutor;

    const refreshExitCode = yield* executor.inherit("dot", [
      "updates",
      "refresh",
      "--dot-only",
    ]);

    if (refreshExitCode !== 0) {
      yield* log.warn(`Update status refresh failed (exit ${refreshExitCode})`);
    }
  });
