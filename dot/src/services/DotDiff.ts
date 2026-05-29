import { Context, Effect, Layer, Schema } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { createHash } from "crypto";
import type { DiffRepo, Repo } from "../types.js";
import { CommandExecutor } from "./CommandExecutor.js";
import { Config } from "./Config.js";
import { extraRepoVisible } from "./repoSchedule.js";

const DEBUG = !!process.env.DOT_DEBUG;
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:DotDiff] ${msg}`);
};

// ---------------------------------------------------------------------------
// Fetch TTL cache (port of fetch_repo_upstream from dot-legacy)
// ---------------------------------------------------------------------------

const FETCH_TTL_SECONDS = parseInt(
  process.env.DOT_FETCH_TTL_SECONDS ?? "300",
  10,
);
const FETCH_CACHE_DIR = join(
  process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? "", ".cache"),
  "dot",
  "fetch-upstream",
);

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

/** Domain error for `dot diff` command failures */
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
                  "git",
                  ["fetch", "--quiet", remoteName, remoteBranch],
                  { cwd: repoPath },
                )
                .pipe(Effect.catch(() => Effect.succeed(1)));

              // Fallback: fetch without branch if specific branch fetch failed
              if (fetchExit !== 0) {
                yield* executor
                  .exitCode("git", ["fetch", "--quiet", remoteName], {
                    cwd: repoPath,
                  })
                  .pipe(Effect.catch(() => Effect.succeed(1)));
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

        return { name, path: repoPath, isDirty, modified, ahead, behind };
      });

      /** Get all repos with enriched diff state */
      const getAll = Effect.fn("DotDiff.getAll")(function* (
        opts?: DiffScanOptions,
      ): Effect.fn.Return<readonly DiffRepo[], DotDiffError> {
        const repoList = buildRepoList();
        log(`Scanning ${repoList.length} repositories...`);

        const results = yield* Effect.all(
          repoList.map((r) => scanRepo(r.name, r.path, opts)),
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
