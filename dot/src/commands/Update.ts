import { Effect } from "effect";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher } from "../services/Launcher.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { DotDiff } from "../git/services/DotDiff.js";
import { stow as runStow } from "./Stow.js";
import { agentsSync } from "./AgentsSync.js";
import { skillUpdates } from "./SkillUpdates.js";
import { rebuild } from "../lib/selfUpdate.js";
import {
  ensureInitCompleteMarker,
  initCompleteMarker,
} from "../lib/initState.js";
import type { ConfigService } from "../services/Config.js";
import type { InitCompleteMarkerStatus } from "../lib/initState.js";

const displayPath = (p: string): string =>
  p.replace(process.env.HOME ?? "", "~");

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
    const launcher = yield* Launcher;
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
    const status = yield* executor
      .run("git", ["-C", path, "status", "--porcelain"])
      .pipe(Effect.catch(() => Effect.succeed("")));
    if (status.trim()) {
      yield* log.warn(
        `Skipping ${name} pull (working tree not clean): ${displayPath(path)}`,
      );
      return false;
    }

    const before = yield* executor
      .run("git", ["-C", path, "rev-parse", "HEAD"])
      .pipe(Effect.catch(() => Effect.succeed("")));

    yield* log.info(`Pulling ${name} (${displayPath(path)})...`);
    const exit = yield* launcher.stream("git pull --rebase --no-edit", {
      cwd: path,
    });

    if (exit !== 0) {
      yield* log.warn(`Pull failed for ${name} — aborting rebase`);
      yield* executor.exitCode("git", ["-C", path, "rebase", "--abort"]);
      return false;
    }

    const after = yield* executor
      .run("git", ["-C", path, "rev-parse", "HEAD"])
      .pipe(Effect.catch(() => Effect.succeed("")));

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

/** Run post-update hooks (agents-sync, skill-updates) */
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

  yield* skillUpdates({ update: true }).pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        yield* log.warn("Skill updates failed (non-fatal)");
      }),
    ),
  );
});

/**
 * Run `dot update`: pull behind repos, restow dotfiles, rebuild the binary.
 *
 * Flags are inclusive — passing any of pull/stow/tui selects only those
 * steps; if none are set, all three run (legacy semantics).
 *
 * The pull phase fetch-scans every tracked repo (public, private, notes,
 * omarchy + worktrees, schedule-gated extras) via {@link DotDiff} and only
 * pulls repos that are behind upstream. Post-hooks (agents-sync, skill
 * updates, notifications) run only when a repo was actually pulled.
 */
export const update = (opts?: {
  readonly pull?: boolean;
  readonly stow?: boolean;
  readonly tui?: boolean;
}) =>
  Effect.gen(function* () {
    const anyFlag = !!(opts?.pull || opts?.stow || opts?.tui);
    const doPull = anyFlag ? !!opts?.pull : true;
    const doStow = anyFlag ? !!opts?.stow : true;
    const doTui = anyFlag ? !!opts?.tui : true;
    const isFullUpdate = doPull && doStow && doTui;

    const config = yield* Config;
    const log = yield* OutputLog;

    yield* log.section("Update Workflow");

    const updatedNames: string[] = [];

    if (doPull) {
      yield* log.section("Pull Repositories");

      const dotDiff = yield* DotDiff;
      const repos = yield* dotDiff
        .getAll()
        .pipe(Effect.catch(() => Effect.succeed([])));

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
      yield* runStow();
    }

    if (doTui) {
      yield* log.section("Rebuild");
      yield* rebuild;
      yield* log.info("Build successful");
    }

    // Post-hooks run only when a repo was actually pulled (legacy semantics).
    if (updatedNames.length > 0) {
      yield* notifyUpdated(updatedNames);
      yield* postHooks;
    }

    if (isFullUpdate) {
      const markerStatus = yield* ensureInitCompleteMarker(config, "update");
      yield* logInitMarkerStatus(markerStatus, config);
    }
  });
