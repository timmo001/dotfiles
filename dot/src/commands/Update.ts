import { Effect } from "effect";
import { existsSync, unlinkSync } from "fs";
import { basename, join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { DotDiff } from "../git/services/DotDiff.js";
import { stow as runStow } from "./Stow.js";
import { agentsSync } from "./AgentsSync.js";
import { writeZshCompletions } from "./Completions.js";
import { rebuild, restartDot } from "../lib/selfUpdate.js";
import { cloneMissingGitConfigRepos } from "../lib/privateGitRepos.js";
import {
  ensureInitCompleteMarker,
  initCompleteMarker,
} from "../lib/initState.js";
import {
  gitHead,
  gitPullRebase,
  gitRefreshRemoteHead,
  gitWorkingTreeClean,
} from "../lib/git.js";
import { HOME_DIR, displayPath } from "../lib/paths.js";
import { detectLegacyHyprRepo } from "../lib/omarchyHost.js";
import type { ConfigService } from "../services/Config.js";
import type { InitCompleteMarkerStatus } from "../lib/initState.js";
import type { DiffRepo, RepoCategory } from "../types.js";

const DISABLE_SELF_UPDATE_ARG = "--no-self-update";
const POST_HOOK_REPO_ARG = "--post-hook-repo";
const SELECTABLE_UPDATE_FLAGS = [
  ["--pull", "pull"],
  ["--stow", "stow"],
  ["--tui", "tui"],
] as const;

/** Options controlling which phases `dot update` runs. */
export interface UpdateOptions {
  /** Run the repository pull phase. */
  readonly pull?: boolean;
  /** Run the stow refresh phase. */
  readonly stow?: boolean;
  /** Run the dot binary rebuild phase. */
  readonly tui?: boolean;
  /** Run the initial self-update/restart phase before the selected phases. */
  readonly selfUpdate?: boolean;
  /** Repository names already pulled before restart, for post-hook handling. */
  readonly postHookRepos?: readonly string[];
}

const repoStatus = (repo: DiffRepo): string => {
  const parts: string[] = [];
  if (repo.isDirty) parts.push(`${repo.modified} modified`);
  if (repo.ahead > 0) parts.push(`${repo.ahead} ahead`);
  if (repo.behind > 0) parts.push(`${repo.behind} behind`);
  return parts.length > 0 ? parts.join(", ") : "up to date";
};

const onResumeHelperPath = (): string | null => {
  return join(HOME_DIR, ".local", "bin", "on-resume");
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
    const pulled = yield* gitPullRebase(path);
    if (!pulled) {
      yield* log.warn(`Pull failed for ${name} — aborting rebase`);
      return false;
    }

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

    yield* executor
      .exitCode("notify-send", [title, message])
      .pipe(Effect.catch(() => Effect.succeed(0)));
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
    yield* rebuild;
    yield* log.info("Self update successful");
    yield* log.info("Restarting update with rebuilt dot binary");
    yield* restartDot(restartUpdateArgs(opts, moved ? repoName : undefined));
  });
}

/**
 * Run post-update hooks (agents-sync).
 */
const postHooks = Effect.gen(function* () {
  const log = yield* OutputLog;

  yield* log.section("Post-Hooks");

  yield* agentsSync.pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        yield* log.warn("Agents sync failed (non-fatal)");
      }),
    ),
  );
});

/**
 * Argument passed to the on-resume helper after an update so it refreshes
 * status-bar services without re-running the dotfiles update-available prompt
 * (which would otherwise pop up immediately after a successful update).
 */
const ON_RESUME_POST_UPDATE_ARG = "--post-update";

/** Run the resume refresh helper so status-bar services pick up update changes. */
const runResumeRefresh = Effect.gen(function* () {
  const log = yield* OutputLog;
  const executor = yield* CommandExecutor;
  const helper = onResumeHelperPath();

  yield* log.section("Resume Refresh");

  if (!helper || !existsSync(helper)) {
    yield* log.warn("Skipping on-resume helper (not installed)");
    return;
  }

  const exitCode = yield* executor
    .exitCode(helper, [ON_RESUME_POST_UPDATE_ARG])
    .pipe(Effect.catch(() => Effect.succeed(1)));

  if (exitCode !== 0) {
    yield* log.warn(`On-resume helper failed (exit ${exitCode})`);
    return;
  }

  yield* log.info("On-resume helper started");
});

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
 * left at 0 when everything in scope is up to date. Used by the on-resume
 * dotfiles update prompt.
 */
export const updateCheck = (opts?: UpdateCheckOptions) =>
  Effect.gen(function* () {
    const log = yield* OutputLog;
    const dotDiff = yield* DotDiff;

    const scopeRepos = opts?.all ? "tracked repos" : "core/system repos";
    yield* log.section("Update Check");

    const repos = yield* log.withSpinner(
      "Checking repositories",
      dotDiff.getAll().pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* log.error(`Update check failed: ${error.message}`);
            return null;
          }),
        ),
      ),
    );

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
 * Flags are inclusive — passing any of pull/stow/tui selects only those
 * steps; if none are set, all three run (legacy semantics).
 *
 * The pull phase fetch-scans every tracked repo (public, private, notes,
 * omarchy + worktrees, schedule-gated extras) via {@link DotDiff} and only
 * pulls repos that are behind upstream. Full updates pull public dotfiles,
 * rebuild, and restart without self-update before continuing the workflow.
 * Pull notifications fire only when a repo actually moved, while post-hooks
 * (agents-sync) run on every full update regardless of pulls
 * and are skipped for flag-scoped runs (e.g. `--stow`/`--tui`/`--pull` only).
 */
export const update = (opts?: UpdateOptions) =>
  Effect.gen(function* () {
    const anyFlag = !!(opts?.pull || opts?.stow || opts?.tui);
    const doPull = anyFlag ? !!opts?.pull : true;
    const doStow = anyFlag ? !!opts?.stow : true;
    const doTui = anyFlag ? !!opts?.tui : opts?.selfUpdate !== false;
    const isFullUpdate = anyFlag ? doPull && doStow && doTui : true;

    const config = yield* Config;
    const log = yield* OutputLog;

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

    if (doPull) {
      yield* log.section("Pull Repositories");
      yield* cloneMissingGitConfigRepos({ strict: false });

      const dotDiff = yield* DotDiff;
      const repos = yield* log.withSpinner(
        "Scanning repositories",
        dotDiff.getAll().pipe(Effect.catch(() => Effect.succeed([]))),
      );
      for (const repo of repos) {
        yield* log.info(
          `${repo.name}: ${repoStatus(repo)} (${displayPath(repo.path)})`,
        );
      }

      // Keep each tracked repo's local <remote>/HEAD pointing at the remote's
      // current default branch. Clones capture it once and never refresh it, so
      // a default-branch rename leaves it stale and misleads default-branch
      // detection in dot git-status, dot git-log, and the branch-context plugin.
      yield* log.withSpinner(
        "Refreshing remote branches",
        Effect.forEach(repos, (repo) => gitRefreshRemoteHead(repo.path), {
          discard: true,
        }),
      );

      if (!config.canUsePrivate) {
        yield* log.warn(`Skipping private pull (${config.privateReason})`);
      }

      const changed = repos.filter(
        (r) => r.isDirty || r.ahead > 0 || r.behind > 0,
      );
      const behind = repos.filter((r) => r.behind > 0);

      if (behind.length === 0) {
        if (changed.length > 0) {
          yield* log.info("Nothing to pull (no repos behind upstream)");

          const notes: string[] = [];
          if (changed.some((r) => r.isDirty)) notes.push("dirty working tree");
          if (changed.some((r) => r.ahead > 0)) notes.push("ahead of upstream");
          yield* log.warn(
            `${changed.length} repo(s) need attention: ${notes.join(", ")}`,
          );
          for (const repo of changed) {
            yield* log.warn(`  - ${repo.name}: ${displayPath(repo.path)}`);
          }
        } else {
          yield* log.info("All repositories are up to date");
        }
      } else {
        yield* log.info(`${changed.length} repo(s) need attention`);
        for (const repo of behind) {
          const moved = yield* safePull(repo.name, repo.path);
          if (moved) updatedNames.push(repo.name);
        }
      }
    }

    if (doStow) {
      yield* log.section("Completions");
      const completionTarget = yield* writeZshCompletions;
      yield* log.info(
        `Generated zsh completions: ${displayPath(completionTarget)}`,
      );

      yield* runStow();
    }

    if (doTui) {
      yield* log.section("Rebuild");
      yield* rebuild;
      yield* log.info("Build successful");
    }

    // Notify only when a repo actually moved.
    if (updatedNames.length > 0) {
      yield* notifyUpdated(updatedNames);
    }

    // Post-hooks (agents-sync) run on every full update,
    // independent of whether a repo was pulled; flag-scoped runs skip them.
    if (isFullUpdate) {
      yield* postHooks;
    }

    if (isFullUpdate) {
      const markerStatus = yield* ensureInitCompleteMarker(config, "update");
      yield* logInitMarkerStatus(markerStatus, config);
    }

    yield* runResumeRefresh;
  });
