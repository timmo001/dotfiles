import { NodeServices } from "@effect/platform-node";
import {
  Clock,
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Schema,
} from "effect";
import { join } from "path";
import { createHash } from "crypto";
import type { DiffRepo, Repo, RepoCategory } from "../../types.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import { OutputLog } from "../../services/OutputLog.js";
import {
  gitCurrentBranch,
  gitRemoteOutput,
  isGitRepo,
  isRemoteTimeout,
} from "../../lib/git.js";
import { CACHE_DIR, displayPath } from "../../lib/paths.js";
import { ENV, envInt, envString } from "../../lib/env.js";
import { isWorkTime } from "../../lib/workTime.js";
import {
  activeGitReposForCheck,
  enabledGitReposForCheck,
} from "../../services/GitConfig.js";

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

/** Repositories scanned at once; each may fetch from its remote. */
const SCAN_CONCURRENCY = 8;

/** Path of the TTL cache entry for a repository's upstream ref */
function fetchCacheFile(repoPath: string, upstreamRef: string): string {
  const cacheKey = createHash("sha1")
    .update(`${repoPath}\n${upstreamRef}\n`)
    .digest("hex");

  return join(FETCH_CACHE_DIR, cacheKey);
}

/** Check if a fetch is needed based on TTL cache */
const shouldFetch = Effect.fn("DotDiff.shouldFetch")(function* (
  repoPath: string,
  upstreamRef: string,
  nowSeconds: number,
) {
  if (FETCH_TTL_SECONDS <= 0) return true;

  const fs = yield* FileSystem.FileSystem;

  yield* fs
    .makeDirectory(FETCH_CACHE_DIR, { recursive: true })
    .pipe(Effect.orDie);

  const lastAttempt = yield* fs
    .readFileString(fetchCacheFile(repoPath, upstreamRef))
    .pipe(
      Effect.map((content) => parseInt(content.trim(), 10)),
      // Cache miss or unreadable — proceed with fetch
      Effect.orElseSucceed(() => NaN),
    );

  if (!isNaN(lastAttempt) && nowSeconds - lastAttempt < FETCH_TTL_SECONDS) {
    log(
      `${repoPath}: fetch cache hit (${nowSeconds - lastAttempt}s < ${FETCH_TTL_SECONDS}s TTL)`,
    );

    return false;
  }

  return true;
});

/** Record a fetch attempt timestamp in the TTL cache */
const recordFetch = Effect.fn("DotDiff.recordFetch")(function* (
  repoPath: string,
  upstreamRef: string,
  nowSeconds: number,
) {
  if (FETCH_TTL_SECONDS <= 0) return;

  const fs = yield* FileSystem.FileSystem;

  yield* fs.makeDirectory(FETCH_CACHE_DIR, { recursive: true }).pipe(
    Effect.andThen(
      fs.writeFileString(
        fetchCacheFile(repoPath, upstreamRef),
        `${nowSeconds}\n`,
      ),
    ),
    // Non-fatal — cache write failure doesn't block diff
    Effect.ignore,
  );
});

/** Record a repository's upstream as freshly fetched so scans skip fetching it again. */
export const recordUpstreamFetch = Effect.fn("DotDiff.recordUpstreamFetch")(
  function* (repoPath: string) {
    const executor = yield* CommandExecutor;

    const upstreamRef = yield* executor
      .run("git", ["rev-parse", "--abbrev-ref", "@{u}"], { cwd: repoPath })
      .pipe(Effect.orElseSucceed(() => ""));

    const trimmedRef = upstreamRef.trim();

    if (!trimmedRef) return;

    const nowSeconds = Math.floor((yield* Clock.currentTimeMillis) / 1000);
    yield* recordFetch(repoPath, trimmedRef, nowSeconds);
  },
);

/** Domain error for `dot git diff` command failures */
export class DotDiffError extends Schema.TaggedError<DotDiffError>()(
  "DotDiffError",
  {
    message: Schema.String,
  },
) {}

/** Options for controlling diff scan behaviour */
export interface DiffScanOptions {
  /** Only scan repositories whose activity schedule is currently active. */
  readonly scheduledOnly?: boolean;
  /** Restrict discovery before fetching or scanning repositories. */
  readonly categories?: ReadonlySet<RepoCategory>;
}

/** Service interface for computing diff state across tracked repositories */
interface DotDiffService {
  /** List repositories that have uncommitted or unpushed changes */
  readonly listChanged: (
    opts?: DiffScanOptions,
  ) => Effect.Effect<readonly Repo[], DotDiffError>;
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
      const platform = NodeServices.layer;
      const fs = yield* FileSystem.FileSystem;

      const exists = (path: string) =>
        fs.exists(path).pipe(Effect.orElseSucceed(() => false));

      /** Discover all omarchy repo targets (including worktrees) */
      const discoverOmarchyRepos = Effect.fn("DotDiff.discoverOmarchyRepos")(
        function* () {
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

            if (!(yield* isGitRepo(repoPath).pipe(Effect.provide(platform))))
              continue;

            // Get current branch to skip it in worktree enumeration
            const currentBranch = yield* gitCurrentBranch(repoPath).pipe(
              Effect.provide(platform),
            );

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
        },
      );

      /** Build the full list of tracked repos */
      const buildRepoList = Effect.fn("DotDiff.buildRepoList")(function* (
        scheduledOnly = false,
        workTimeActive = false,
        now: Date = new Date(),
      ) {
        const repos: Array<{
          name: string;
          path: string;
          category: RepoCategory;
        }> = [];

        const seenPaths = new Set<string>();

        const configuredRepos = [
          ...config.gitConfig.repositories,
          ...config.gitConfig.shortcuts,
        ];

        const addRepo = (repo: {
          name: string;
          path: string;
          category: RepoCategory;
        }): void => {
          if (seenPaths.has(repo.path)) return;
          seenPaths.add(repo.path);
          repos.push({
            ...repo,
            name:
              configuredRepos.find(
                (configured) => configured.path === repo.path,
              )?.name ?? repo.name,
          });
        };

        // Public dotfiles
        if (yield* exists(config.publicDotfiles)) {
          addRepo({
            name: "Dotfiles",
            path: config.publicDotfiles,
            category: "dotfiles",
          });
        }

        // Private dotfiles
        if (config.canUsePrivate && config.privateDotfiles) {
          if (yield* exists(config.privateDotfiles)) {
            addRepo({
              name: "Dotfiles Private",
              path: config.privateDotfiles,
              category: "dotfiles",
            });
          }
        }

        // Notes
        if (yield* exists(config.notesDir)) {
          addRepo({
            name: "Notes",
            path: config.notesDir,
            category: "notes",
          });
        }

        // Omarchy repos
        const omarchyTargets = yield* discoverOmarchyRepos();

        for (const target of omarchyTargets) {
          if (yield* exists(target.path)) {
            addRepo(target);
          }
        }

        // Private git config activity repos, sorted alphabetically
        if (config.canUsePrivate) {
          const configured = scheduledOnly
            ? activeGitReposForCheck(
                config.gitConfig,
                "activity",
                now,
                workTimeActive,
              )
            : enabledGitReposForCheck(config.gitConfig, "activity");

          const visible = [...configured].sort((a, b) =>
            a.name.localeCompare(b.name),
          );

          for (const extra of visible) {
            if (yield* exists(extra.path)) {
              addRepo({
                name: extra.name,
                path: extra.path,
                category: "private",
              });
            }
          }
        }

        return repos;
      });

      /** Scan a single repo for git status */
      const scanRepo = Effect.fn("DotDiff.scanRepo")(function* (
        name: string,
        repoPath: string,
        category: RepoCategory,
      ): Effect.fn.Return<DiffRepo | null, DotDiffError> {
        if (!(yield* isGitRepo(repoPath).pipe(Effect.provide(platform)))) {
          log(`${name}: not a git repo, skipping`);

          return null;
        }

        // Background scans must not refresh the index and contend with writers.
        const statusResult = yield* executor
          .run("git", ["--no-optional-locks", "status", "--porcelain"], {
            cwd: repoPath,
          })
          .pipe(Effect.orElseSucceed(() => ""));

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
          const upstreamRef = yield* executor
            .run("git", ["rev-parse", "--abbrev-ref", "@{u}"], {
              cwd: repoPath,
            })
            .pipe(Effect.orElseSucceed(() => ""));

          const trimmedRef = upstreamRef.trim();

          const nowSeconds = Math.floor(
            (yield* Clock.currentTimeMillis) / 1000,
          );

          if (
            trimmedRef &&
            (yield* shouldFetch(repoPath, trimmedRef, nowSeconds).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
            ))
          ) {
            const [remoteName] = trimmedRef.split("/", 1);
            const remoteBranch = trimmedRef.slice(remoteName.length + 1);

            const fetchError = (target: readonly string[]) =>
              gitRemoteOutput(
                ["fetch", "--quiet", ...target],
                { cwd: repoPath },
                FETCH_TIMEOUT,
              ).pipe(
                Effect.as(null),
                Effect.catch((error) => Effect.succeed(error.message)),
                Effect.provideService(CommandExecutor, executor),
              );

            const branchError = yield* fetchError([remoteName, remoteBranch]);

            // Fallback: fetch without branch if specific branch fetch failed
            const error =
              branchError && !isRemoteTimeout(branchError)
                ? yield* fetchError([remoteName])
                : branchError;

            if (error && isRemoteTimeout(error)) {
              yield* outputLog.warn(
                `Fetch timed out after ${FETCH_TIMEOUT_SECONDS}s for ${name}: ${displayPath(repoPath)}`,
              );
            }

            yield* recordFetch(repoPath, trimmedRef, nowSeconds).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
            );
          }

          const aheadStr = yield* executor
            .run("git", ["rev-list", "--count", "@{u}..HEAD"], {
              cwd: repoPath,
            })
            .pipe(Effect.orElseSucceed(() => "0"));

          ahead = parseInt(aheadStr.trim(), 10) || 0;

          const behindStr = yield* executor
            .run("git", ["rev-list", "--count", "HEAD..@{u}"], {
              cwd: repoPath,
            })
            .pipe(Effect.orElseSucceed(() => "0"));

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
        const workTimeActive =
          opts?.scheduledOnly &&
          enabledGitReposForCheck(config.gitConfig, "activity").some(
            (repo) => repo.activity.schedule === "work",
          )
            ? yield* isWorkTime((message) =>
                Effect.sync(() => log(message)),
              ).pipe(
                Effect.provideService(Config, config),
                Effect.provide(platform),
              )
            : false;

        const now = new Date(yield* Clock.currentTimeMillis);

        const repoList = (yield* buildRepoList(
          opts?.scheduledOnly,
          workTimeActive,
          now,
        )).filter(
          (repo) => !opts?.categories || opts.categories.has(repo.category),
        );

        log(`Scanning ${repoList.length} repositories...`);

        const results = yield* Effect.forEach(
          repoList,
          (r) => scanRepo(r.name, r.path, r.category),
          { concurrency: SCAN_CONCURRENCY },
        );

        const repos = results.filter((r) => r !== null);
        log(`Scan complete: ${repos.length} repos found`);

        return repos;
      });

      return {
        getAll: (opts) => getAll(opts),
        listChanged: (opts) =>
          Effect.gen(function* () {
            const all = yield* getAll(opts);

            return all
              .filter((r) => r.isDirty || r.ahead > 0 || r.behind > 0)
              .map((r) => ({ name: r.name, path: r.path, locked: false }));
          }),
      };
    }),
  ).pipe(Layer.provide(NodeServices.layer));
}
