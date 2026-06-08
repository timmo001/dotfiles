import { Effect } from "effect";
import { existsSync, unlinkSync } from "fs";
import { basename, join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Launcher } from "../services/Launcher.js";
import { DotDiff } from "../git/services/DotDiff.js";
import { stow as runStow } from "./Stow.js";
import { agentsSync } from "./AgentsSync.js";
import { writeZshCompletions } from "./Completions.js";
import { skillUpdates } from "./SkillUpdates.js";
import { rebuild, restartDot } from "../lib/selfUpdate.js";
import { cloneMissingGitConfigRepos } from "../lib/privateGitRepos.js";
import {
  ensureInitCompleteMarker,
  initCompleteMarker,
} from "../lib/initState.js";
import { gitHead, gitPullRebase, gitWorkingTreeClean } from "../lib/git.js";
import { HOME_DIR, displayPath } from "../lib/paths.js";
import type { ConfigService } from "../services/Config.js";
import type { InitCompleteMarkerStatus } from "../lib/initState.js";
import type { DiffRepo } from "../types.js";

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
 * Run post-update hooks (agents-sync, skill-updates).
 *
 * Resolves to `true` when skill updates created a reviewable commit.
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

  const skillUpdateMode = isInteractiveSession() ? undefined : { update: true };

  return yield* skillUpdates(skillUpdateMode).pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        yield* log.warn("Skill updates failed (non-fatal)");
        return false;
      }),
    ),
  );
});

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
    .exitCode(helper, [])
    .pipe(Effect.catch(() => Effect.succeed(1)));

  if (exitCode !== 0) {
    yield* log.warn(`On-resume helper failed (exit ${exitCode})`);
    return;
  }

  yield* log.info("On-resume helper started");
});

/** True when attached to an interactive terminal and not in tee-log mode. */
const isInteractiveSession = (): boolean =>
  !!process.stdin.isTTY &&
  !!process.stdout.isTTY &&
  process.env.DOT_TEE_INHERIT_LOG !== "1";

/** Block until the user presses any key, restoring the prior raw-mode state. */
const waitForKeypress = Effect.promise(
  () =>
    new Promise<void>((resolve) => {
      process.stdout.write(
        "\n\x1b[90mPress any key to open dot git-diff...\x1b[0m",
      );
      const wasRaw = process.stdin.isRaw;
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once("data", () => {
        if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
        process.stdin.pause();
        resolve();
      });
    }),
);

/**
 * Surface the diff created by skill updates at the end of an update.
 *
 * In an interactive session: print a brief message, pause for a keypress, then
 * launch `dot git-diff` to review the new commit. Otherwise just log a hint.
 */
const reviewSkillUpdates = Effect.gen(function* () {
  const log = yield* OutputLog;

  yield* log.section("Skill Updates Review");

  if (!isInteractiveSession()) {
    yield* log.info(
      "Skill updates created a commit; run dot git-diff to review",
    );
    return;
  }

  const launcher = yield* Launcher;
  yield* log.info("Skill updates created a commit. Review it in dot git-diff.");
  yield* waitForKeypress;
  yield* launcher.suspend("dot git-diff").pipe(Effect.catch(() => Effect.void));
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
 * (agents-sync, skill updates) run on every full update regardless of pulls
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

    const updatedNames = [...(opts?.postHookRepos ?? [])];

    if (doPull) {
      yield* log.section("Pull Repositories");
      yield* cloneMissingGitConfigRepos({ strict: false });

      const dotDiff = yield* DotDiff;
      const repos = yield* dotDiff
        .getAll()
        .pipe(Effect.catch(() => Effect.succeed([])));
      for (const repo of repos) {
        yield* log.info(
          `${repo.name}: ${repoStatus(repo)} (${displayPath(repo.path)})`,
        );
      }

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

    // Post-hooks (agents-sync, skill updates) run on every full update,
    // independent of whether a repo was pulled; flag-scoped runs skip them.
    let skillDiffCreated = false;
    if (isFullUpdate) {
      skillDiffCreated = yield* postHooks;
    }

    if (isFullUpdate) {
      const markerStatus = yield* ensureInitCompleteMarker(config, "update");
      yield* logInitMarkerStatus(markerStatus, config);
    }

    yield* runResumeRefresh;

    if (skillDiffCreated) {
      yield* reviewSkillUpdates;
    }
  });
