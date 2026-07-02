import { Context, Duration, Effect, Layer, Option, Schema } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { createHash } from "crypto";
import type { DiffRepo, Repo, RepoCategory } from "../../types.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import { OutputLog } from "../../services/OutputLog.js";
import { gitCurrentBranchSync, isGitRepo } from "../../lib/git.js";
import { CACHE_DIR, displayPath } from "../../lib/paths.js";
import { ENV, envInt, envString } from "../../lib/env.js";
import { activeGitReposForCheck } from "../../services/GitConfig.js";

const DEBUG = !!envString(ENV.DOT_DEBUG);
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:DotDiff] ${msg}`);
};

// ---------------------------------------------------------------------------
// Fetch TTL cache for upstream git fetches
// ---------------------------------------------------------------------------

const FETCH_TTL_SECONDS = envInt(ENV.DOT_FETCH_TTL_SECONDS, 300);
const FETCH_TIMEOUT_SECONDS = 20;
const FETCH_TIMEOUT = Duration.seconds(FETCH_TIMEOUT_SECONDS);
const FETCH_CACHE_DIR = join(CACHE_DIR, "dot", "fetch-upstream");

/** Check if a fetch is needed based on TTL cache */
function shouldFetch(repoPath: string, upstreamRef: string): boolean {
  if (FETCH_TTL_SECONDS <= 0) return true;

  mkdirSync(FETCH_CACHE_DIR, { recursive: true });
  const cacheKey = createHash("sha1")
    .update(`${repoPath}\n${upstreamRef}\n`)
    .digest("hex");
  const cacheFile = join(FETCH_CACHE_DIR, cacheKey);

  try {
    const lastAttempt = parseInt(readFileSync(cacheFile, "utf-8").trim(), 10);
    if (!isNaN(lastAttempt)) {
      const now = Math.floor(Date.now() / 1000);
      if (now - lastAttempt < FETCH_TTL_SECONDS) {
        log(
          `${repoPath}: fetch cache hit (${now - lastAttempt}s < ${FETCH_TTL_SECONDS}s TTL)`,
        );
        return false;
      }
    }
  } catch {
    // Cache miss or unreadable — proceed with fetch
  }

  return true;
}

/** Record a fetch attempt timestamp in the TTL cache */
function recordFetch(repoPath: string, upstreamRef: string): void {
  if (FETCH_TTL_SECONDS <= 0) return;

  try {
    mkdirSync(FETCH_CACHE_DIR, { recursive: true });
    const cacheKey = createHash("sha1")
      .update(`${repoPath}\n${upstreamRef}\n`)
      .digest("hex");
    const cacheFile = join(FETCH_CACHE_DIR, cacheKey);
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(cacheFile, `${now}\n`);
  } catch {
    // Non-fatal — cache write failure doesn't block diff
  }
}

/** Domain error for `dot git-diff` command failures */
export class DotDiffError extends Schema.TaggedErrorClass<DotDiffError>()(
  "DotDiffError",
  {
    message: Schema.String,
  },
) {}

/** Options for controlling diff scan behaviour */
export interface DiffScanOptions {
  /** Skip fetching from remotes (use local tracking refs only) */
  readonly noFetch?: boolean;
}

/** Service interface for computing diff state across tracked repositories */
interface DotDiffService {
  /** List repositories that have uncommitted or unpushed changes */
  readonly listChanged: (
    opts?: DiffScanOptions,
  ) => Effect.Effect<readonly Repo[], DotDiffError>;
  /** List all tracked repositories (lightweight, no git scan) */
  readonly listAll: () => Effect.Effect<readonly Repo[], DotDiffError>;
  /** Get enriched diff state for all tracked repositories */
  readonly getAll: (
    opts?: DiffScanOptions,
  ) => Effect.Effect<readonly DiffRepo[], DotDiffError>;
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
      const outputLog = yield* OutputLog;

      /** Discover all omarchy repo targets (including worktrees) */
      const discoverOmarchyRepos = (): Array<{
        name: string;
        path: string;
        category: RepoCategory;
      }> => {
        if (!config.omarchy.enabled) return [];

        const targets: Array<{
          name: string;
          path: string;
          category: RepoCategory;
        }> = [];
        const { repoBase, diffRepos, worktreeRepos, worktreeBranches } =
          config.omarchy;

        for (const repoName of diffRepos) {
          const repoPath = join(repoBase, repoName);
          targets.push({
            name: `omarchy:${repoName}`,
            path: repoPath,
            category: "omarchy",
          });

          // Check for worktree branches
          if (!worktreeRepos.includes(repoName)) continue;
          if (!isGitRepo(repoPath)) continue;

          // Get current branch to skip it in worktree enumeration
          const currentBranch = gitCurrentBranchSync(repoPath);

          for (const branch of worktreeBranches) {
            if (branch === currentBranch) continue;
            const worktreePath = join(repoBase, `${repoName}-${branch}`);
            targets.push({
              name: `omarchy:${repoName}-${branch}`,
              path: worktreePath,
              category: "omarchy",
            });
          }
        }

        return targets;
      };

      /** Build the full list of tracked repos */
      const buildRepoList = (): Array<{
        name: string;
        path: string;
        category: RepoCategory;
      }> => {
        const repos: Array<{
          name: string;
          path: string;
          category: RepoCategory;
        }> = [];
        const seenPaths = new Set<string>();
        const addRepo = (repo: {
          name: string;
          path: string;
          category: RepoCategory;
        }): void => {
          if (seenPaths.has(repo.path)) return;
          seenPaths.add(repo.path);
          repos.push(repo);
        };

        // Public dotfiles
        if (existsSync(config.publicDotfiles)) {
          addRepo({
            name: basename(config.publicDotfiles),
            path: config.publicDotfiles,
            category: "dotfiles",
          });
        }

        // Private dotfiles
        if (config.canUsePrivate && config.privateDotfiles) {
          if (existsSync(config.privateDotfiles)) {
            addRepo({
              name: basename(config.privateDotfiles),
              path: config.privateDotfiles,
              category: "dotfiles",
            });
          }
        }

        // Notes
        if (existsSync(config.notesDir)) {
          addRepo({
            name: basename(config.notesDir),
            path: config.notesDir,
            category: "notes",
          });
        }

        // Omarchy repos
        const omarchyTargets = discoverOmarchyRepos();
        for (const target of omarchyTargets) {
          if (existsSync(target.path)) {
            addRepo(target);
          }
        }

        // Private git config activity repos (schedule-gated, sorted alphabetically)
        if (config.canUsePrivate) {
          const visible = [
            ...activeGitReposForCheck(config.gitConfig, "activity"),
          ].sort((a, b) => a.name.localeCompare(b.name));
          for (const extra of visible) {
            if (existsSync(extra.path)) {
              addRepo({
                name: `private:${extra.name}`,
                path: extra.path,
                category: "private",
              });
            }
          }
        }

        return repos;
      };

      /** Scan a single repo for git status */
      const scanRepo = Effect.fn("DotDiff.scanRepo")(function* (
        name: string,
        repoPath: string,
        category: RepoCategory,
        opts?: DiffScanOptions,
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
          // Fetch from remote to ensure tracking ref is up to date (TTL-cached)
          if (!opts?.noFetch) {
            const upstreamRef = yield* executor
              .run("git", ["rev-parse", "--abbrev-ref", "@{u}"], {
                cwd: repoPath,
              })
              .pipe(Effect.catch(() => Effect.succeed("")));

            const trimmedRef = upstreamRef.trim();
            if (trimmedRef && shouldFetch(repoPath, trimmedRef)) {
              const [remoteName] = trimmedRef.split("/", 1);
              const remoteBranch = trimmedRef.slice(remoteName.length + 1);
              const fetchExit = yield* executor
                .exitCode(
                  "env",
                  [
                    "GIT_TERMINAL_PROMPT=0",
                    "git",
                    "fetch",
                    "--quiet",
                    remoteName,
                    remoteBranch,
                  ],
                  { cwd: repoPath },
                )
                .pipe(
                  Effect.timeoutOption(FETCH_TIMEOUT),
                  Effect.catch(() => Effect.succeed(Option.some(1))),
                );

              if (Option.isNone(fetchExit)) {
                yield* outputLog.warn(
                  `Fetch timed out after ${FETCH_TIMEOUT_SECONDS}s for ${name}: ${displayPath(repoPath)}`,
                );
              }

              // Fallback: fetch without branch if specific branch fetch failed
              if (Option.isSome(fetchExit) && fetchExit.value !== 0) {
                const fallbackExit = yield* executor
                  .exitCode(
                    "env",
                    [
                      "GIT_TERMINAL_PROMPT=0",
                      "git",
                      "fetch",
                      "--quiet",
                      remoteName,
                    ],
                    { cwd: repoPath },
                  )
                  .pipe(
                    Effect.timeoutOption(FETCH_TIMEOUT),
                    Effect.catch(() => Effect.succeed(Option.some(1))),
                  );
                if (Option.isNone(fallbackExit)) {
                  yield* outputLog.warn(
                    `Fallback fetch timed out after ${FETCH_TIMEOUT_SECONDS}s for ${name}: ${displayPath(repoPath)}`,
                  );
                }
              }
              recordFetch(repoPath, trimmedRef);
            }
          }

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

        return {
          name,
          path: repoPath,
          category,
          isDirty,
          modified,
          ahead,
          behind,
        };
      });

      /** Get all repos with enriched diff state */
      const getAll = Effect.fn("DotDiff.getAll")(function* (
        opts?: DiffScanOptions,
      ): Effect.fn.Return<readonly DiffRepo[], DotDiffError> {
        const repoList = buildRepoList();
        log(`Scanning ${repoList.length} repositories...`);

        const results = yield* Effect.all(
          repoList.map((r) => scanRepo(r.name, r.path, r.category, opts)),
          { concurrency: 4 },
        );

        const repos = results.filter((r): r is DiffRepo => r !== null);
        log(`Scan complete: ${repos.length} repos found`);
        return repos;
      });

      return {
        getAll: (opts) => getAll(opts),
        listAll: () =>
          Effect.gen(function* () {
            const repoList = buildRepoList();
            return repoList
              .filter((r) => isGitRepo(r.path))
              .map((r) => ({ name: r.name, path: r.path, locked: false }));
          }),
        listChanged: (opts) =>
          Effect.gen(function* () {
            const all = yield* getAll(opts);
            return all
              .filter((r) => r.isDirty || r.ahead > 0 || r.behind > 0)
              .map((r) => ({ name: r.name, path: r.path, locked: false }));
          }),
      };
    }),
  );
}
