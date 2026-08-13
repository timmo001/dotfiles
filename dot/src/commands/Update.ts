import { Effect, Option, Schema } from "effect";
import { existsSync, unlinkSync } from "fs";
import { basename, join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { DotDiff } from "../git/services/DotDiff.js";
import { stow as runStow } from "./Stow.js";
import { agentsSync } from "./AgentsSync.js";
import { mcpSync } from "../mcp/commands/McpSync.js";
import { writeAllCompletions } from "./Completions.js";
import { rebuild, restartDot } from "../lib/selfUpdate.js";
import { cloneMissingGitConfigRepos } from "../lib/privateGitRepos.js";
import { trustTrackedMiseConfigs } from "../lib/miseTrust.js";
import { loadPrivatePackageRepoConfig } from "../doctor/checks/packages.js";
import { withSpinnerTimeout, withStepTimeout } from "../lib/workflowStep.js";
import {
  ensureInitCompleteMarker,
  initCompleteMarker,
} from "../lib/initState.js";
import {
  gitExitCode,
  gitHead,
  gitPullRebase,
  gitRefreshRemoteHead,
  gitWorkingTreeClean,
} from "../lib/git.js";
import { HOME_DIR, displayPath } from "../lib/paths.js";
import { detectLegacyHyprRepo } from "../lib/omarchyHost.js";
import { managedGitRepos } from "../services/GitConfig.js";
import { setupPrivateRepo } from "./SetupPrivateRepo.js";
import type { ConfigService } from "../services/Config.js";
import type { GitManagedRepo } from "../services/GitConfig.js";
import type { InitCompleteMarkerStatus } from "../lib/initState.js";
import type { DiffRepo, RepoCategory } from "../types.js";

const DISABLE_SELF_UPDATE_ARG = "--no-self-update";
const POST_HOOK_REPO_ARG = "--post-hook-repo";
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
const LOCAL_HERDR_PLUGINS = [
  "terminal-title",
  "yazi",
  "repository-picker",
  "mise-task-runner",
] as const;

/**
 * Per-attempt bound for a single repo pull. A slow response is assumed to be
 * GitHub under load or a flaky local connection rather than something worth
 * waiting on, so this is deliberately short; the pull is retried once.
 */
const PULL_ATTEMPT_TIMEOUT_SECONDS = 30;

/** Upper bound for repository scans that include fetches. */
const REPO_SCAN_TIMEOUT_SECONDS = 60;

/** Attempts per repo: the initial pull plus one retry. */
const PULL_MAX_ATTEMPTS = 2;

/** Upper bound (seconds) for each update step. */
const STEP_TIMEOUT_SECONDS = {
  pull: 8 * 60,
  stow: 3 * 60,
  rebuild: 5 * 60,
  herdrPlugins: 5 * 60,
  postHooks: 2 * 60,
  uiReload: 60,
} as const;

/** Upper bound for one repository post-update command. */
const REPO_POST_UPDATE_TIMEOUT_SECONDS = 5 * 60;

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
  /** Repository names already pulled before restart, for post-hook handling. */
  readonly postHookRepos?: readonly string[];
}

class UpdateError extends Schema.TaggedErrorClass<UpdateError>()(
  "UpdateError",
  {
    message: Schema.String,
  },
) {}

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

const repoStatus = (repo: DiffRepo): string => {
  const parts: string[] = [];
  if (repo.isDirty) parts.push(`${repo.modified} modified`);
  if (repo.ahead > 0) parts.push(`${repo.ahead} ahead`);
  if (repo.behind > 0) parts.push(`${repo.behind} behind`);
  return parts.length > 0 ? parts.join(", ") : "up to date";
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
 * skips repos with a dirty working tree, pulls with `--rebase`, and aborts
 * the rebase on failure. Returns true only if the pull moved HEAD.
 */
const safePull = (name: string, path: string) =>
  Effect.gen(function* () {
    const log = yield* OutputLog;
    const executor = yield* CommandExecutor;

    // Clear a stale index lock; skip if held by a running git process.
    const lockFile = join(path, ".git", "index.lock");
    if (existsSync(lockFile)) {
      const held = yield* executor.exitCode("fuser", [lockFile]);
      if (held === 0) {
        yield* log.warn(
          `Lock held by active git process for ${name}: ${displayPath(path)}`,
        );
        yield* log.info(`Skipping ${name} pull (lock held)`);
        return false;
      }
      yield* log.warn(
        `Removing stale lock for ${name}: ${displayPath(lockFile)}`,
      );
      yield* Effect.sync(() => {
        try {
          unlinkSync(lockFile);
        } catch {
          // Already gone — fine
        }
      });
    }

    // Skip repos with uncommitted changes.
    const clean = yield* gitWorkingTreeClean(path).pipe(
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!clean) {
      yield* log.warn(
        `Skipping ${name} pull (working tree not clean): ${displayPath(path)}`,
      );
      return false;
    }

    const before = yield* gitHead(path).pipe(
      Effect.catch(() => Effect.succeed("")),
    );

    yield* log.info(`Pulling ${name} (${displayPath(path)})...`);

    let pulled = false;
    for (let attempt = 1; attempt <= PULL_MAX_ATTEMPTS; attempt++) {
      const outcome = yield* withSpinnerTimeout(
        `Pulling ${name} (${attempt}/${PULL_MAX_ATTEMPTS}, timeout ${PULL_ATTEMPT_TIMEOUT_SECONDS}s)`,
        PULL_ATTEMPT_TIMEOUT_SECONDS,
        gitPullRebase(path),
      );
      if (Option.isSome(outcome) && outcome.value) {
        pulled = true;
        break;
      }

      // Clean up any half-applied rebase left by a failed or interrupted pull
      // before retrying or moving on.
      yield* gitExitCode(["rebase", "--abort"], { cwd: path });

      const reason = Option.isNone(outcome)
        ? `timed out after ${PULL_ATTEMPT_TIMEOUT_SECONDS}s`
        : "failed";
      if (attempt < PULL_MAX_ATTEMPTS) {
        yield* log.warn(
          `Pull ${reason} for ${name}, retrying (${attempt + 1}/${PULL_MAX_ATTEMPTS})...`,
        );
      } else {
        yield* log.warn(
          `Pull ${reason} for ${name} after ${PULL_MAX_ATTEMPTS} attempts, skipping`,
        );
      }
    }

    if (!pulled) return false;

    const after = yield* gitHead(path).pipe(
      Effect.catch(() => Effect.succeed("")),
    );

    return before.trim() !== "" && after.trim() !== "" && before !== after;
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
    yield* log.info(`${repo.name} post-update command complete`);
  });

function selectedUpdateFlags(opts?: UpdateOptions): readonly string[] {
  return SELECTABLE_UPDATE_FLAGS.filter(([, key]) => opts?.[key]).map(
    ([flag]) => flag,
  );
}

function restartUpdateArgs(
  opts: UpdateOptions | undefined,
  pulledRepoName?: string,
): readonly string[] {
  return [
    "update",
    ...selectedUpdateFlags(opts),
    DISABLE_SELF_UPDATE_ARG,
    ...(pulledRepoName ? [POST_HOOK_REPO_ARG, pulledRepoName] : []),
  ];
}

function selfUpdateAndRestart(
  config: ConfigService,
  opts: UpdateOptions | undefined,
) {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    yield* log.section("Self Update");
    const repoName = basename(config.publicDotfiles);
    const moved = yield* safePull(repoName, config.publicDotfiles);
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
    yield* log.info("Self update successful");
    yield* log.info("Restarting update with rebuilt dot binary");
    yield* restartDot(restartUpdateArgs(opts, moved ? repoName : undefined));
  });
}

/**
 * Run post-update hooks.
 */
const postHooks = Effect.gen(function* () {
  const log = yield* OutputLog;
  const executor = yield* CommandExecutor;

  yield* log.section("Post-Hooks");

  yield* agentsSync;

  const patchExit = yield* executor.inherit("apply-omarchy-patches", []);
  if (patchExit !== 0) {
    return yield* new UpdateError({
      message: `Omarchy patch application exited ${patchExit}`,
    });
  }
});

/** Read the Herdr Lazy plugin root from `herdr plugin list --json`. */
export function herdrLazyPluginRoot(source: string): string | null {
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object") return null;

    const result = (parsed as Record<string, unknown>).result;
    if (!result || typeof result !== "object") return null;

    const plugins = (result as Record<string, unknown>).plugins;
    if (!Array.isArray(plugins)) return null;

    for (const plugin of plugins) {
      if (!plugin || typeof plugin !== "object") continue;
      const record = plugin as Record<string, unknown>;
      if (
        record.plugin_id === "herdr-lazy" &&
        typeof record.plugin_root === "string"
      ) {
        return record.plugin_root;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/** Restore Herdr plugins to the commits in the stowed Herdr Lazy lockfile. */
const restoreHerdrPlugins = Effect.gen(function* () {
  const log = yield* OutputLog;
  const executor = yield* CommandExecutor;
  const config = yield* Config;

  yield* log.section("Herdr Plugins");

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
  if (!existsSync(binary)) {
    yield* log.warn("Skipping Herdr plugins (Herdr Lazy binary is missing)");
    return;
  }

  const exitCode = yield* executor.inherit(binary, ["restore"]);
  if (exitCode !== 0) {
    return yield* new UpdateError({
      message: `Herdr plugin restore exited ${exitCode}`,
    });
  }

  yield* log.info("Herdr plugins restored from lockfile");

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

  yield* log.info("Herdr local plugins linked");
});

/** Reload the UI so status-bar services pick up update changes. */
const runUiReload = Effect.gen(function* () {
  const log = yield* OutputLog;
  const executor = yield* CommandExecutor;
  const helper = reloadUiHelperPath();

  yield* log.section("Reload UI");

  if (!existsSync(helper)) {
    yield* log.warn("Skipping reload-ui helper (not installed)");
    return;
  }

  const exitCode = yield* executor.exitCode(helper, ["--no-auto-open"]);

  if (exitCode !== 0) {
    yield* log.warn(`Reload UI helper failed (exit ${exitCode})`);
    return;
  }

  yield* log.info("On-resume helper started");
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

  yield* log.info("Reloaded Omarchy shell (shell.json changed)");
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
  /** Check every tracked repo instead of only core/system repos. */
  readonly all?: boolean;
}

/**
 * Report tracked repos that are behind upstream without pulling or stowing.
 *
 * Scans repos via {@link DotDiff} (TTL-cached fetch). By default only
 * core/system repos (dotfiles + omarchy) are considered; `all` widens the
 * scope to every tracked repo. Sets the process exit code to
 * {@link UPDATE_CHECK_AVAILABLE_EXIT} when at least one in-scope repo is behind
 * upstream and {@link UPDATE_CHECK_ERROR_EXIT} when the scan fails; the code is
 * left at 0 when everything in scope is up to date.
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
      dotDiff.getAll().pipe(
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
    const behind = scoped.filter((repo) => repo.behind > 0);

    if (behind.length === 0) {
      yield* log.info(`All ${scopeRepos} are up to date`);
      return;
    }

    yield* log.info(
      `${behind.length} of ${scoped.length} ${scopeRepos} behind upstream:`,
    );
    for (const repo of behind) {
      yield* log.info(`  ${repo.name}: ${repo.behind} behind`);
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
    const legacy = detectLegacyHyprRepo(config);
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
 * The pull phase fetch-scans every tracked repo (public, private, notes,
 * omarchy + worktrees, schedule-gated extras) via {@link DotDiff} and only
 * pulls repos that are behind upstream. It then marks any mise config files in
 * the tracked repos as trusted (best-effort) so `mise` never prompts for them
 * on this machine. Full updates pull public dotfiles,
 * rebuild, and restart without self-update before continuing the workflow.
 * Pull notifications fire only when a repo actually moved, while post-hooks
 * (agents-sync) run on every full update regardless of pulls
 * and are skipped for flag-scoped runs (e.g. `--stow`/`--app`/`--pull` only).
 */
export const update = (opts?: UpdateOptions) =>
  Effect.gen(function* () {
    const anyFlag = !!(opts?.pull || opts?.stow || opts?.app);
    const doPull = anyFlag ? !!opts?.pull : true;
    const doStow = anyFlag ? !!opts?.stow : true;
    const doApp = anyFlag ? !!opts?.app : opts?.selfUpdate !== false;
    const isFullUpdate = anyFlag ? doPull && doStow && doApp : true;

    const config = yield* Config;
    const log = yield* OutputLog;
    const privatePackageRepo = config.canUsePrivate
      ? loadPrivatePackageRepoConfig(config)
      : null;

    yield* log.section("Update Workflow");

    if (isFullUpdate && opts?.selfUpdate !== false) {
      yield* selfUpdateAndRestart(config, opts);
      return;
    }

    // Migration halt: a machine still on the retired omarchy-hypr clone must
    // back it up before stow can take over. Runs after the self-update restart
    // so the rebuilt binary (carrying this guard) performs the check, halting
    // the first phase until the legacy repo is resolved.
    if (doPull || doStow) {
      const halted = yield* haltOnLegacyHyprRepo(config);
      if (halted) return;
    }

    const updatedNames = [...(opts?.postHookRepos ?? [])];
    let privatePackageRepoUpdated = false;

    if (doPull) {
      yield* requiredUpdateStep(
        "Pull Repositories",
        STEP_TIMEOUT_SECONDS.pull,
        Effect.gen(function* () {
          yield* log.section("Pull Repositories");
          yield* cloneMissingGitConfigRepos({ strict: false });

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
          for (const repo of repos) {
            yield* log.info(
              `${repo.name}: ${repoStatus(repo)} (${displayPath(repo.path)})`,
            );
          }

          // Race the best-effort branch refresh against the pull: whichever finishes
          // first, the update continues. `git remote set-head --auto` re-points each
          // repo's local <remote>/HEAD at the remote default branch (so a rename does
          // not mislead default-branch detection in context git and the branch-context
          // plugin), but it hits the network per repo and can hang
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
                Effect.andThen(log.info("Refreshed remote branches")),
                Effect.forkScoped,
              );

              if (!config.canUsePrivate) {
                yield* log.warn(
                  `Skipping private pull (${config.privateReason})`,
                );
              }

              const changed = repos.filter(
                (r) => r.isDirty || r.ahead > 0 || r.behind > 0,
              );
              const behind = repos.filter((r) => r.behind > 0);

              if (behind.length === 0) {
                if (changed.length > 0) {
                  yield* log.info("Nothing to pull (no repos behind upstream)");

                  const notes: string[] = [];
                  if (changed.some((r) => r.isDirty))
                    notes.push("dirty working tree");
                  if (changed.some((r) => r.ahead > 0))
                    notes.push("ahead of upstream");
                  yield* log.warn(
                    `${changed.length} repo(s) need attention: ${notes.join(", ")}`,
                  );
                  for (const repo of changed) {
                    yield* log.warn(
                      `  - ${repo.name}: ${displayPath(repo.path)}`,
                    );
                  }
                } else {
                  yield* log.info("All repositories are up to date");
                }
              } else {
                yield* log.info(`${changed.length} repo(s) need attention`);
                for (const repo of behind) {
                  const moved = yield* safePull(repo.name, repo.path);
                  if (moved) {
                    updatedNames.push(repo.name);
                    if (repo.path === privatePackageRepo?.path) {
                      privatePackageRepoUpdated = true;
                    }
                  }
                }
              }
            }),
          );

          // Trust mise configs in freshly pulled/cloned repos so mise never
          // prompts for them on this machine.
          yield* trustTrackedMiseConfigs;

          const updated = new Set(updatedNames);
          for (const repo of managedGitRepos(config.gitConfig)) {
            if (updated.has(repo.name)) yield* runRepoPostUpdate(repo);
          }

          if (privatePackageRepoUpdated) {
            yield* setupPrivateRepo;
          }
        }),
      );
    }

    let shellConfigChanged = false;
    if (doStow) {
      yield* requiredUpdateStep(
        "Stow",
        STEP_TIMEOUT_SECONDS.stow,
        Effect.gen(function* () {
          yield* log.section("Completions");
          const completionTargets = yield* writeAllCompletions;
          for (const completionTarget of completionTargets) {
            yield* log.info(
              `Generated completions: ${displayPath(completionTarget)}`,
            );
          }

          yield* mcpSync;

          shellConfigChanged = yield* runStow();
        }),
      );
    }

    yield* reloadOmarchyShellIfChanged(shellConfigChanged);

    if (doApp) {
      yield* requiredUpdateStep(
        "Rebuild",
        STEP_TIMEOUT_SECONDS.rebuild,
        Effect.gen(function* () {
          yield* log.section("Rebuild");
          yield* rebuild;
          yield* log.info("Build successful");
        }),
      );
    }

    if (isFullUpdate) {
      yield* requiredUpdateStep(
        "Herdr Plugins",
        STEP_TIMEOUT_SECONDS.herdrPlugins,
        restoreHerdrPlugins,
      );
    }

    // Notify only when a repo actually moved.
    if (updatedNames.length > 0) {
      yield* notifyUpdated(updatedNames);
    }

    // Post-hooks run on every full update,
    // independent of whether a repo was pulled; flag-scoped runs skip them.
    if (isFullUpdate) {
      yield* requiredUpdateStep(
        "Post-Hooks",
        STEP_TIMEOUT_SECONDS.postHooks,
        postHooks,
      );
    }

    if (isFullUpdate) {
      const markerStatus = yield* ensureInitCompleteMarker(config, "update");
      yield* logInitMarkerStatus(markerStatus, config);
    }

    yield* withStepTimeout(
      "Reload UI",
      STEP_TIMEOUT_SECONDS.uiReload,
      runUiReload,
    );
  });
