import { Clock, Context, Effect, Layer, PubSub, Stream } from "effect";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  WorkflowRepoRuns,
  WorkflowRunQueryOptions,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowState,
} from "../types.js";
import { CommandExecutor } from "./CommandExecutor.js";
import { Config, type ExtraRepo } from "./Config.js";
import {
  extraRepoVisible,
  findWorkflowExtraRepo,
  workflowSlugVisible,
} from "./repoSchedule.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER ?? ""}`;
const RUN_LIMIT = 100;
const DEBUG = !!process.env.DOT_DEBUG;
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:WorkflowRuns] ${msg}`);
};

interface WorkflowRunsService {
  /** Subscribe to workflow run state snapshots */
  readonly subscribe: () => Stream.Stream<WorkflowState>;
  /** Refresh watched repo workflow runs from GitHub */
  readonly refresh: (opts?: WorkflowRunQueryOptions) => Effect.Effect<void>;
  /** Return the most recent workflow run state */
  readonly getState: () => Effect.Effect<WorkflowState>;
}

interface WatchlistResult {
  readonly path: string;
  readonly slugs: readonly string[];
  readonly message?: string;
}

interface WorkflowTarget {
  readonly slug: string;
  readonly checkoutPath: string | null;
  readonly error?: string;
}

interface ResolvedWatchlist {
  readonly targets: readonly WorkflowTarget[];
  readonly message?: string;
}

interface CommitInfo {
  readonly sha: string;
  readonly branch: string;
  readonly subject: string | null;
  readonly url: string | null;
}

interface WorkflowCheckoutCandidate {
  readonly path: string;
  readonly visible: boolean;
}

interface GhRunRecord {
  readonly databaseId?: unknown;
  readonly workflowDatabaseId?: unknown;
  readonly status?: unknown;
  readonly conclusion?: unknown;
  readonly workflowName?: unknown;
  readonly displayTitle?: unknown;
  readonly url?: unknown;
  readonly event?: unknown;
  readonly createdAt?: unknown;
  readonly startedAt?: unknown;
  readonly updatedAt?: unknown;
}

interface GhWorkflowRecord {
  readonly id?: unknown;
  readonly state?: unknown;
}

/** Effect service for {@link WorkflowRunsService} */
export class WorkflowRuns extends Context.Service<
  WorkflowRuns,
  WorkflowRunsService
>()("WorkflowRuns") {
  static readonly layer = Layer.effect(
    WorkflowRuns,
    Effect.gen(function* () {
      log("Initialising WorkflowRuns...");
      const config = yield* Config;
      const executor = yield* CommandExecutor;
      const pubsub = yield* PubSub.unbounded<WorkflowState>();

      const initialWatchlist = readWatchlist(getWatchlistPath(config));
      let currentState = buildState(
        initialWatchlist.slugs.map(emptyRepo),
        new Date(yield* Clock.currentTimeMillis),
        false,
        false,
        initialWatchlist.message,
        undefined,
      );

      const fetchRepoRuns = Effect.fn("WorkflowRuns.fetchRepoRuns")(function* (
        { slug, checkoutPath, error }: WorkflowTarget,
        opts?: WorkflowRunQueryOptions,
      ) {
        if (!checkoutPath) {
          return {
            ...emptyRepo(slug),
            error: error ?? "local checkout not found in .dot-extra-repos",
          };
        }

        const commit = yield* getHeadCommit(slug, checkoutPath);
        const runs = yield* getRuns(slug, commit.branch, commit.sha, opts);

        return {
          slug,
          branch: commit.branch,
          headSha: commit.sha,
          commitSubject: commit.subject,
          commitUrl: commit.url,
          runs,
        };
      });

      const getHeadCommit = Effect.fn("WorkflowRuns.getHeadCommit")(function* (
        slug: string,
        repoPath: string,
      ) {
        const branch = (yield* executor.run(
          "git",
          ["branch", "--show-current"],
          { cwd: repoPath },
        )).trim();

        if (!branch) {
          return yield* Effect.fail(new Error("current branch not found"));
        }

        const sha = (yield* executor.run("git", ["rev-parse", "HEAD"], {
          cwd: repoPath,
        })).trim();
        const subject = (yield* executor.run(
          "git",
          ["log", "-1", "--pretty=%s"],
          {
            cwd: repoPath,
          },
        )).trim();

        return {
          sha,
          branch,
          subject: subject || null,
          url: `https://github.com/${slug}/commit/${sha}`,
        };
      });

      const getRuns = Effect.fn("WorkflowRuns.getRuns")(function* (
        slug: string,
        branch: string,
        sha: string,
        opts?: WorkflowRunQueryOptions,
      ) {
        const activeWorkflowIds = yield* getActiveWorkflowIds(slug);
        const raw = yield* executor.run(
          "gh",
          runListArgs(slug, branch, sha, opts),
        );
        const parsed = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (error) =>
            error instanceof Error ? error : new Error(String(error)),
        });
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter(isRunRecord)
          .map(toWorkflowRun)
          .filter((run) => runMatchesActiveWorkflow(run, activeWorkflowIds))
          .filter((run) => runMatchesSince(run, opts?.since));
      });

      const getActiveWorkflowIds = Effect.fn(
        "WorkflowRuns.getActiveWorkflowIds",
      )(function* (slug: string) {
        const raw = yield* executor.run("gh", workflowListArgs(slug));
        const parsed = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (error) =>
            error instanceof Error ? error : new Error(String(error)),
        });

        return new Set(
          Array.isArray(parsed)
            ? parsed
                .filter(isWorkflowRecord)
                .filter(workflowIsActive)
                .map(workflowId)
                .filter((id): id is string => id !== null)
            : [],
        );
      });

      const runListArgs = (
        slug: string,
        branch: string,
        sha: string,
        opts?: WorkflowRunQueryOptions,
      ): readonly string[] => {
        const args = [
          "run",
          "list",
          "--repo",
          slug,
          "--branch",
          branch,
          "--commit",
          sha,
          "--limit",
          String(RUN_LIMIT),
          "--json",
          "databaseId,workflowDatabaseId,status,conclusion,workflowName,displayTitle,url,event,createdAt,startedAt,updatedAt",
        ];
        return args;
      };

      const workflowListArgs = (slug: string): readonly string[] => [
        "workflow",
        "list",
        "--repo",
        slug,
        "--all",
        "--limit",
        "1000",
        "--json",
        "id,state",
      ];

      const resolveWorkflowTarget = Effect.fn(
        "WorkflowRuns.resolveWorkflowTarget",
      )(function* (slug: string) {
        if (!workflowSlugVisible(slug, config.extraRepos)) return null;

        const directMatch = findWorkflowExtraRepo(slug, config.extraRepos);
        const candidate = directMatch
          ? { path: directMatch.path, visible: extraRepoVisible(directMatch) }
          : yield* findConfiguredRepoByRemoteSlug(slug);
        return workflowTargetFromCandidate(slug, candidate);
      });

      const findConfiguredRepoByRemoteSlug = Effect.fn(
        "WorkflowRuns.findConfiguredRepoByRemoteSlug",
      )(function* (slug: string) {
        for (const repo of configuredRepoCandidates(config)) {
          const remote = yield* executor
            .run("git", ["config", "--get", "remote.origin.url"], {
              cwd: repo.path,
            })
            .pipe(Effect.catch(() => Effect.succeed("")));
          if (parseGithubRepoSlug(remote.trim()) === slug) return repo;
        }

        return undefined;
      });

      const resolveWatchlist = Effect.fn("WorkflowRuns.resolveWatchlist")(
        function* (watchlist: WatchlistResult) {
          const targets: readonly (WorkflowTarget | null)[] = yield* Effect.all(
            watchlist.slugs.map((slug) => resolveWorkflowTarget(slug)),
            { concurrency: 4 },
          );
          const visibleTargets = targets.filter(
            (target): target is WorkflowTarget => target !== null,
          );
          return {
            targets: visibleTargets,
            message: resolvedWatchlistMessage(
              watchlist.message,
              watchlist.slugs.length,
              visibleTargets.length,
            ),
          };
        },
      );

      const refresh = (opts?: WorkflowRunQueryOptions) =>
        Effect.gen(function* () {
          log("Refreshing workflow runs...");
          const watchlist = readWatchlist(getWatchlistPath(config));
          const resolved = yield* resolveWatchlist(watchlist);
          currentState = buildState(
            resolved.targets.map(targetToLoadingRepo),
            new Date(yield* Clock.currentTimeMillis),
            true,
            currentState.loaded,
            resolved.message,
            opts,
          );
          yield* PubSub.publish(pubsub, currentState);

          if (resolved.targets.length === 0) {
            currentState = buildState(
              [],
              new Date(yield* Clock.currentTimeMillis),
              false,
              true,
              resolved.message,
              opts,
            );
            yield* PubSub.publish(pubsub, currentState);
            return;
          }

          const hasGh = (yield* executor.exitCode("which", ["gh"])) === 0;
          if (!hasGh) {
            currentState = buildState(
              resolved.targets.map((target) => ({
                ...emptyRepo(target.slug),
                error: "gh CLI not found",
              })),
              new Date(yield* Clock.currentTimeMillis),
              false,
              true,
              resolved.message,
              opts,
            );
            yield* PubSub.publish(pubsub, currentState);
            return;
          }

          const repos = yield* Effect.all(
            resolved.targets.map((target) =>
              fetchRepoRuns(target, opts).pipe(
                Effect.catch((error) =>
                  Effect.succeed({
                    ...emptyRepo(target.slug),
                    error: formatError(error),
                  }),
                ),
              ),
            ),
            { concurrency: 4 },
          );

          currentState = buildState(
            repos,
            new Date(yield* Clock.currentTimeMillis),
            false,
            true,
            resolved.message,
            opts,
          );
          yield* PubSub.publish(pubsub, currentState);
          log(`Refresh complete: ${repos.length} watched repos`);
        }).pipe(
          Effect.withSpan("WorkflowRuns.refresh"),
          Effect.catch((error) => {
            log(`Refresh failed: ${formatError(error)}`);
            currentState = buildState(
              currentState.repos,
              new Date(),
              false,
              currentState.loaded,
              formatError(error),
              { since: opts?.since ?? currentState.since ?? undefined },
            );
            return PubSub.publish(pubsub, currentState).pipe(Effect.asVoid);
          }),
        );

      return {
        subscribe: () => Stream.fromPubSub(pubsub),
        refresh: (opts) => refresh(opts),
        getState: () => Effect.succeed(currentState),
      };
    }),
  );
}

function getWatchlistPath(config: { readonly privateDotfiles: string | null }) {
  return (
    process.env.DOT_WORKFLOW_WATCH_REPOS_FILE ??
    join(
      config.privateDotfiles ?? join(HOME, ".config", "dotfiles-private"),
      ".git-workflow-watch-repos",
    )
  );
}

function configuredRepoCandidates(config: {
  readonly publicDotfiles: string;
  readonly privateDotfiles: string | null;
  readonly notesDir: string | null;
  readonly extraRepos: readonly ExtraRepo[];
}): readonly WorkflowCheckoutCandidate[] {
  const seen = new Set<string>();
  const repos: WorkflowCheckoutCandidate[] = [];
  const add = (repo: WorkflowCheckoutCandidate | null) => {
    if (!repo || seen.has(repo.path)) return;
    seen.add(repo.path);
    repos.push(repo);
  };

  add({ path: config.publicDotfiles, visible: true });
  if (config.privateDotfiles)
    add({ path: config.privateDotfiles, visible: true });
  if (config.notesDir) add({ path: config.notesDir, visible: true });
  for (const repo of config.extraRepos) {
    add({ path: repo.path, visible: extraRepoVisible(repo) });
  }
  return repos;
}

function readWatchlist(path: string): WatchlistResult {
  if (!existsSync(path)) {
    return {
      path,
      slugs: [],
      message: `Watchlist missing: ${displayPath(path)}`,
    };
  }

  try {
    const seen = new Set<string>();
    const slugs: string[] = [];
    const content = readFileSync(path, "utf-8");

    for (const rawLine of content.split("\n")) {
      const line = rawLine.split("#", 1)[0]?.trim() ?? "";
      if (!line) continue;

      const slug = parseGithubRepoSlug(line);
      if (slug && !seen.has(slug)) {
        seen.add(slug);
        slugs.push(slug);
      }
    }

    return { path, slugs };
  } catch (error) {
    return {
      path,
      slugs: [],
      message: `Could not read ${displayPath(path)}: ${formatError(error)}`,
    };
  }
}

function targetToLoadingRepo(target: WorkflowTarget): WorkflowRepoRuns {
  return {
    ...emptyRepo(target.slug),
    ...(target.error && { error: target.error }),
  };
}

function workflowTargetFromCandidate(
  slug: string,
  candidate: WorkflowCheckoutCandidate | undefined,
): WorkflowTarget | null {
  if (!candidate) {
    return {
      slug,
      checkoutPath: null,
      error: "local checkout not found in .dot-extra-repos",
    };
  }
  return candidate.visible ? { slug, checkoutPath: candidate.path } : null;
}

function resolvedWatchlistMessage(
  currentMessage: string | undefined,
  watchedCount: number,
  targetCount: number,
): string | undefined {
  if (currentMessage) return currentMessage;
  if (targetCount > 0) return undefined;
  if (watchedCount === 0) return undefined;
  return `${watchedCount} watched ${hiddenRepoPhrase(watchedCount)} hidden by schedule`;
}

function hiddenRepoPhrase(count: number): string {
  return count === 1 ? "repo is" : "repos are";
}

function parseGithubRepoSlug(value: string): string | null {
  let slug = value.trim();
  if (slug.startsWith("git@github.com:")) {
    slug = slug.slice("git@github.com:".length);
  } else if (slug.startsWith("ssh://git@github.com/")) {
    slug = slug.slice("ssh://git@github.com/".length);
  } else if (slug.startsWith("https://github.com/")) {
    slug = slug.slice("https://github.com/".length);
  } else if (slug.startsWith("http://github.com/")) {
    slug = slug.slice("http://github.com/".length);
  } else if (slug.startsWith("git://github.com/")) {
    slug = slug.slice("git://github.com/".length);
  }

  slug = slug.replace(/\.git$/, "").replace(/\/$/, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug) ? slug : null;
}

function emptyRepo(slug: string): WorkflowRepoRuns {
  return {
    slug,
    branch: null,
    headSha: null,
    commitSubject: null,
    commitUrl: null,
    runs: [],
  };
}

function buildState(
  repos: readonly WorkflowRepoRuns[],
  lastChecked: Date,
  loading: boolean,
  loaded: boolean,
  message?: string,
  opts?: WorkflowRunQueryOptions,
): WorkflowState {
  return {
    repos,
    lastChecked,
    loading,
    loaded,
    since: opts?.since ?? null,
    ...(message && { message }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRunRecord(value: unknown): value is GhRunRecord {
  return isRecord(value);
}

function isWorkflowRecord(value: unknown): value is GhWorkflowRecord {
  return isRecord(value);
}

function toWorkflowRun(record: GhRunRecord): WorkflowRun {
  const id =
    typeof record.databaseId === "number" ||
    typeof record.databaseId === "string"
      ? String(record.databaseId)
      : "";
  const workflowName = stringValue(record.workflowName) || "Unnamed workflow";
  const displayTitle = stringValue(record.displayTitle) || workflowName;

  return {
    id,
    workflowId: nullableIdValue(record.workflowDatabaseId),
    workflowName,
    displayTitle,
    status: normalizeStatus(stringValue(record.status)),
    conclusion: nullableStringValue(record.conclusion),
    url: stringValue(record.url),
    event: stringValue(record.event),
    createdAt: nullableStringValue(record.createdAt),
    startedAt: nullableStringValue(record.startedAt),
    updatedAt: nullableStringValue(record.updatedAt),
  };
}

function workflowId(record: GhWorkflowRecord): string | null {
  return nullableIdValue(record.id);
}

function workflowIsActive(record: GhWorkflowRecord): boolean {
  return record.state === "active";
}

function runMatchesActiveWorkflow(
  run: WorkflowRun,
  activeWorkflowIds: ReadonlySet<string>,
): boolean {
  return run.workflowId === null || activeWorkflowIds.has(run.workflowId);
}

function runMatchesSince(run: WorkflowRun, since: string | undefined): boolean {
  if (!since) return true;
  const activityAt = workflowActivityTime(run);
  const sinceAt = Date.parse(since);
  return Number.isFinite(activityAt) && activityAt >= sinceAt;
}

function workflowActivityTime(run: WorkflowRun): number {
  return Math.max(
    parseWorkflowTime(run.createdAt),
    parseWorkflowTime(run.startedAt),
    parseWorkflowTime(run.updatedAt),
  );
}

function parseWorkflowTime(value: string | null): number {
  return value ? Date.parse(value) : NaN;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableIdValue(value: unknown): string | null {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : null;
}

function normalizeStatus(status: string): WorkflowRunStatus {
  switch (status) {
    case "completed":
    case "in_progress":
    case "queued":
    case "requested":
    case "waiting":
    case "pending":
      return status;
    default:
      return "unknown";
  }
}

function formatError(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { readonly stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.length > 0) return stderr;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function displayPath(path: string): string {
  return path.startsWith(HOME) ? `~${path.slice(HOME.length)}` : path;
}
