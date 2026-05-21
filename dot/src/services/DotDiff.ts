import { Context, Effect, Layer, Schema } from "effect";
import { existsSync } from "fs";
import { basename, join } from "path";
import type { DiffRepo, Repo } from "../types.js";
import { CommandExecutor } from "./CommandExecutor.js";
import { Config, type ExtraRepo } from "./Config.js";

const DEBUG = !!process.env.DOT_DEBUG;
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:DotDiff] ${msg}`);
};

// ---------------------------------------------------------------------------
// Cron schedule matching (port of dot-cron-lib)
// ---------------------------------------------------------------------------

/** Check if a single cron field matches a value (supports *, ranges, lists) */
function cronFieldMatches(
  value: number,
  expr: string,
  min: number,
  max: number,
): boolean {
  const trimmed = expr.trim();
  if (trimmed === "*" || trimmed === "?") return true;

  // Handle comma-separated list
  const parts = trimmed.split(",");
  for (const part of parts) {
    // Handle step: */2 or 1-5/2
    const [rangePart, stepStr] = part.split("/", 2);
    const step = stepStr ? parseInt(stepStr, 10) : 1;

    if (rangePart === "*") {
      // */step
      for (let i = min; i <= max; i += step) {
        if (i === value) return true;
      }
    } else if (rangePart.includes("-")) {
      // Range: 8-15
      const [startStr, endStr] = rangePart.split("-", 2);
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      for (let i = start; i <= end; i += step) {
        if (i === value) return true;
      }
    } else {
      // Single value
      if (parseInt(rangePart, 10) === value) return true;
    }
  }

  return false;
}

/** Check if a cron expression matches the current time */
function cronScheduleActive(schedule: string): boolean {
  if (!schedule.trim()) return true;

  const fields = schedule.trim().split(/\s+/);
  if (fields.length < 5) return true; // Malformed — treat as always active

  const now = new Date();
  const [minuteExpr, hourExpr, domExpr, monthExpr, dowExpr] = fields;

  const minute = now.getMinutes();
  const hour = now.getHours();
  const dom = now.getDate();
  const month = now.getMonth() + 1; // 1-indexed
  const dow = now.getDay(); // 0=Sunday

  return (
    cronFieldMatches(minute, minuteExpr, 0, 59) &&
    cronFieldMatches(hour, hourExpr, 0, 23) &&
    cronFieldMatches(dom, domExpr, 1, 31) &&
    cronFieldMatches(month, monthExpr, 1, 12) &&
    cronFieldMatches(dow, dowExpr, 0, 6)
  );
}

/** Check if an extra repo is currently visible based on its schedule */
function extraRepoVisible(repo: ExtraRepo): boolean {
  return cronScheduleActive(repo.schedule);
}

/** Domain error for `dot diff` command failures */
export class DotDiffError extends Schema.TaggedErrorClass<DotDiffError>()(
  "DotDiffError",
  {
    message: Schema.String,
  },
) {}

/** Service interface for computing diff state across tracked repositories */
interface DotDiffService {
  /** List repositories that have uncommitted or unpushed changes */
  readonly listChanged: () => Effect.Effect<readonly Repo[], DotDiffError>;
  /** List all tracked repositories */
  readonly listAll: () => Effect.Effect<readonly Repo[], DotDiffError>;
  /** Get enriched diff state for all tracked repositories */
  readonly getAll: () => Effect.Effect<readonly DiffRepo[], DotDiffError>;
}

/** Effect service for {@link DotDiffService} */
export class DotDiff extends Context.Service<DotDiff, DotDiffService>()(
  "DotDiff",
) {
  static readonly layer = Layer.effect(
    DotDiff,
    Effect.gen(function* () {
      const config = yield* Config;
      const executor = yield* CommandExecutor;

      /** Check if a path is a valid git repository */
      const isGitRepo = (repoPath: string): boolean => {
        if (!existsSync(repoPath)) return false;
        return existsSync(join(repoPath, ".git"));
      };

      /** Discover all omarchy repo targets (including worktrees) */
      const discoverOmarchyRepos = (): Array<{
        name: string;
        path: string;
      }> => {
        if (!config.omarchy.enabled) return [];

        const targets: Array<{ name: string; path: string }> = [];
        const { repoBase, diffRepos, worktreeRepos, worktreeBranches } =
          config.omarchy;

        for (const repoName of diffRepos) {
          const repoPath = join(repoBase, repoName);
          targets.push({ name: `omarchy:${repoName}`, path: repoPath });

          // Check for worktree branches
          if (!worktreeRepos.includes(repoName)) continue;
          if (!isGitRepo(repoPath)) continue;

          // Get current branch to skip it in worktree enumeration
          let currentBranch = "";
          try {
            const result = Bun.spawnSync(
              ["git", "rev-parse", "--abbrev-ref", "HEAD"],
              { cwd: repoPath, stdout: "pipe", stderr: "pipe" },
            );
            currentBranch = new TextDecoder().decode(result.stdout).trim();
          } catch {
            // ignore
          }

          for (const branch of worktreeBranches) {
            if (branch === currentBranch) continue;
            const worktreePath = join(repoBase, `${repoName}-${branch}`);
            targets.push({
              name: `omarchy:${repoName}-${branch}`,
              path: worktreePath,
            });
          }
        }

        return targets;
      };

      /** Build the full list of tracked repos */
      const buildRepoList = (): Array<{ name: string; path: string }> => {
        const repos: Array<{ name: string; path: string }> = [];

        // Public dotfiles
        if (existsSync(config.publicDotfiles)) {
          repos.push({
            name: basename(config.publicDotfiles),
            path: config.publicDotfiles,
          });
        }

        // Private dotfiles
        if (config.canUsePrivate && config.privateDotfiles) {
          if (existsSync(config.privateDotfiles)) {
            repos.push({
              name: basename(config.privateDotfiles),
              path: config.privateDotfiles,
            });
          }

          // Notes
          if (config.notesDir && existsSync(config.notesDir)) {
            repos.push({
              name: basename(config.notesDir),
              path: config.notesDir,
            });
          }
        }

        // Omarchy repos
        const omarchyTargets = discoverOmarchyRepos();
        for (const target of omarchyTargets) {
          if (existsSync(target.path)) {
            repos.push(target);
          }
        }

        // Extra repos (schedule-gated, sorted alphabetically)
        if (config.canUsePrivate) {
          const visible = config.extraRepos
            .filter((r) => extraRepoVisible(r))
            .sort((a, b) => a.name.localeCompare(b.name));
          for (const extra of visible) {
            if (existsSync(extra.path)) {
              repos.push({ name: `extra:${extra.name}`, path: extra.path });
            }
          }
        }

        return repos;
      };

      /** Scan a single repo for git status */
      const scanRepo = Effect.fn("DotDiff.scanRepo")(function* (
        name: string,
        repoPath: string,
      ): Effect.fn.Return<DiffRepo | null, DotDiffError> {
        if (!isGitRepo(repoPath)) {
          log(`${name}: not a git repo, skipping`);
          return null;
        }

        // Get porcelain status (dirty/modified count)
        const statusResult = yield* executor
          .run("git", ["status", "--porcelain"], { cwd: repoPath })
          .pipe(Effect.catch(() => Effect.succeed("")));

        const statusLines = statusResult
          .trim()
          .split("\n")
          .filter((l) => l.length > 0);
        const modified = statusLines.length;
        const isDirty = modified > 0;

        // Check ahead/behind counts
        let ahead = 0;
        let behind = 0;

        // First check if there's an upstream configured
        const hasUpstream = yield* executor.exitCode(
          "git",
          ["rev-parse", "@{u}"],
          { cwd: repoPath },
        );

        if (hasUpstream === 0) {
          const aheadStr = yield* executor
            .run("git", ["rev-list", "--count", "@{u}..HEAD"], {
              cwd: repoPath,
            })
            .pipe(Effect.catch(() => Effect.succeed("0")));
          ahead = parseInt(aheadStr.trim(), 10) || 0;

          const behindStr = yield* executor
            .run("git", ["rev-list", "--count", "HEAD..@{u}"], {
              cwd: repoPath,
            })
            .pipe(Effect.catch(() => Effect.succeed("0")));
          behind = parseInt(behindStr.trim(), 10) || 0;
        }

        return { name, path: repoPath, isDirty, modified, ahead, behind };
      });

      /** Get all repos with enriched diff state */
      const getAll = Effect.fn("DotDiff.getAll")(function* (): Effect.fn.Return<
        readonly DiffRepo[],
        DotDiffError
      > {
        const repoList = buildRepoList();
        log(`Scanning ${repoList.length} repositories...`);

        const results = yield* Effect.all(
          repoList.map((r) => scanRepo(r.name, r.path)),
          { concurrency: 4 },
        );

        const repos = results.filter((r): r is DiffRepo => r !== null);
        log(`Scan complete: ${repos.length} repos found`);
        return repos;
      });

      return {
        getAll: () => getAll(),
        listAll: () =>
          Effect.gen(function* () {
            const repoList = buildRepoList();
            return repoList
              .filter((r) => isGitRepo(r.path))
              .map((r) => ({ name: r.name, path: r.path, locked: false }));
          }),
        listChanged: () =>
          Effect.gen(function* () {
            const all = yield* getAll();
            return all
              .filter((r) => r.isDirty || r.ahead > 0 || r.behind > 0)
              .map((r) => ({ name: r.name, path: r.path, locked: false }));
          }),
      };
    }),
  );
}
