import { Clock, Context, Effect, Layer, PubSub, Schema, Stream } from "effect";
import { existsSync } from "node:fs";
import type {
  WorkflowRepoRuns,
  WorkflowRunQueryOptions,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowState,
} from "../../types.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import {
  activeGitReposForCheck,
  managedGitRepos,
  type DotGitConfig,
} from "../../services/GitConfig.js";
import { gitOutput } from "../../lib/git.js";
import { GitHub } from "./GitHub.js";
import {
  formatGhError,
  nullableIdValue,
  nullableStringValue,
  stringValue,
} from "./record.js";
import { repoGitHubSlugs } from "./repoRelations.js";
import { ENV, envString } from "../../lib/env.js";

const BRANCH_RUN_LIMIT = 30;
const DEBUG = !!envString(ENV.DOT_DEBUG);
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:WorkflowRuns] ${msg}`);
};

class WorkflowRunsError extends Schema.TaggedErrorClass<WorkflowRunsError>()(
  "WorkflowRunsError",
  {
    message: Schema.String,
  },
) {}

interface WorkflowRunsService {
  /** Subscribe to workflow run state snapshots */
  readonly subscribe: () => Stream.Stream<WorkflowState>;
  /** Refresh watched repo workflow runs from GitHub */
  readonly refresh: (opts?: WorkflowRunQueryOptions) => Effect.Effect<void>;
  /** Return the most recent workflow run state */
  readonly getState: () => Effect.Effect<WorkflowState>;
}

interface WorkflowTarget {
  readonly slug: string;
  readonly checkoutPath: string;
}

interface CommitInfo {
  readonly sha: string;
  readonly branch: string;
  readonly subject: string | null;
  readonly url: string | null;
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
  readonly headBranch?: unknown;
  readonly headSha?: unknown;
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
      const github = yield* GitHub;
      const pubsub = yield* PubSub.unbounded<WorkflowState>();

      const initialTargets = workflowTargets(config);
      let currentState = buildState(
        initialTargets.map(targetToLoadingRepo),
        new Date(yield* Clock.currentTimeMillis),
        false,
        false,
        workflowTargetMessage(config, initialTargets.length),
        undefined,
      );

      const fetchRepoRuns = Effect.fn("WorkflowRuns.fetchRepoRuns")(function* (
        { slug, checkoutPath }: WorkflowTarget,
        opts?: WorkflowRunQueryOptions,
      ) {
        if (!existsSync(checkoutPath)) {
          return {
            ...emptyRepo(slug),
            error: "local checkout not found from dot-git.yml",
          };
        }

        const branches = yield* localBranches(checkoutPath);
        if (branches.length === 0) return emptyRepo(slug);

        const commit = yield* getHeadCommit(slug, checkoutPath);
        const slugs = yield* repoGitHubSlugs(slug, checkoutPath, executor);
        const slugRuns = yield* Effect.all(
          slugs.flatMap((candidate) =>
            branches.map((branch) => {
              const runs = getRuns(candidate, branch, opts);
              return candidate === slug
                ? runs
                : runs.pipe(Effect.catch(() => Effect.succeed([])));
            }),
          ),
          { concurrency: 4 },
        );
        const runs = uniqueWorkflowRuns(slugRuns.flat());

        return {
          slug,
          branch: branches.length === 1 ? branches[0] : commit.branch || null,
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
        const branch = (yield* gitOutput(["branch", "--show-current"], {
          cwd: repoPath,
        }).pipe(Effect.provideService(CommandExecutor, executor))).trim();

        if (!branch) {
          return yield* new WorkflowRunsError({
            message: "current branch not found",
          });
        }

        const sha = (yield* gitOutput(["rev-parse", "HEAD"], {
          cwd: repoPath,
        }).pipe(Effect.provideService(CommandExecutor, executor))).trim();
        const subject = (yield* gitOutput(["log", "-1", "--pretty=%s"], {
          cwd: repoPath,
        }).pipe(Effect.provideService(CommandExecutor, executor))).trim();

        return {
          sha,
          branch,
          subject: subject || null,
          url: `https://github.com/${slug}/commit/${sha}`,
        };
      });

      const localBranches = (repoPath: string) =>
        gitOutput(["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
          cwd: repoPath,
        }).pipe(
          Effect.provideService(CommandExecutor, executor),
          Effect.map((output) =>
            output
              .split("\n")
              .map((b) => b.trim())
              .filter((b) => b.length > 0),
          ),
          Effect.catch(() => Effect.succeed([])),
        );

      const getRuns = Effect.fn("WorkflowRuns.getRuns")(function* (
        slug: string,
        branch: string,
        opts?: WorkflowRunQueryOptions,
      ) {
        const activeWorkflowIds = yield* getActiveWorkflowIds(slug);
        const parsed = yield* github.json(runListArgs(slug, branch));
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
        const parsed = yield* github.json(workflowListArgs(slug));

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

      const runListArgs = (slug: string, branch: string): readonly string[] => [
        "run",
        "list",
        "--repo",
        slug,
        "--branch",
        branch,
        "--limit",
        String(BRANCH_RUN_LIMIT),
        "--json",
        "databaseId,workflowDatabaseId,status,conclusion,workflowName,displayTitle,url,event,createdAt,startedAt,updatedAt,headBranch,headSha",
      ];

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

      const refresh = Effect.fn("WorkflowRuns.refresh")(function* (
        opts?: WorkflowRunQueryOptions,
      ) {
        log("Refreshing workflow runs...");
        const targets = workflowTargets(config);
        const message = workflowTargetMessage(config, targets.length);
        currentState = buildState(
          targets.map(targetToLoadingRepo),
          new Date(yield* Clock.currentTimeMillis),
          true,
          currentState.loaded,
          message,
          opts,
        );
        yield* PubSub.publish(pubsub, currentState);

        if (targets.length === 0) {
          currentState = buildState(
            [],
            new Date(yield* Clock.currentTimeMillis),
            false,
            true,
            message,
            opts,
          );
          yield* PubSub.publish(pubsub, currentState);
          return;
        }

        const hasGh = yield* github.isAvailable();
        if (!hasGh) {
          currentState = buildState(
            targets.map((target) => ({
              ...emptyRepo(target.slug),
              error: "gh CLI not found",
            })),
            new Date(yield* Clock.currentTimeMillis),
            false,
            true,
            message,
            opts,
          );
          yield* PubSub.publish(pubsub, currentState);
          return;
        }

        const repos = yield* Effect.all(
          targets.map((target) =>
            fetchRepoRuns(target, opts).pipe(
              Effect.catch((error) =>
                Effect.succeed({
                  ...emptyRepo(target.slug),
                  error: formatGhError(error),
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
          message,
          opts,
        );
        yield* PubSub.publish(pubsub, currentState);
        log(`Refresh complete: ${repos.length} workflow repos`);
      });

      return {
        subscribe: () => Stream.fromPubSub(pubsub),
        refresh: (opts) => refresh(opts),
        getState: () => Effect.succeed(currentState),
      };
    }),
  );
}

function workflowTargets(config: {
  readonly canUsePrivate: boolean;
  readonly gitConfig: DotGitConfig;
}): readonly WorkflowTarget[] {
  if (!config.canUsePrivate) return [];
  return activeGitReposForCheck(config.gitConfig, "workflows").map((repo) => ({
    slug: repo.github,
    checkoutPath: repo.path,
  }));
}

function workflowTargetMessage(
  config: {
    readonly canUsePrivate: boolean;
    readonly privateReason: string;
    readonly gitConfig: DotGitConfig;
  },
  targetCount: number,
): string | undefined {
  if (!config.canUsePrivate) {
    return `Skipping workflow config (${config.privateReason})`;
  }
  if (!config.gitConfig.valid) return config.gitConfig.diagnostics.join("; ");

  const enabledCount = managedGitRepos(config.gitConfig).filter(
    (repo) => repo.workflows.enabled,
  ).length;
  if (targetCount > 0 || enabledCount === 0) return undefined;
  return `${enabledCount} workflow ${repoNoun(enabledCount)} hidden by schedule`;
}

function targetToLoadingRepo(target: WorkflowTarget): WorkflowRepoRuns {
  return {
    ...emptyRepo(target.slug),
  };
}

function repoNoun(count: number): string {
  return count === 1 ? "repo" : "repos";
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

function uniqueWorkflowRuns(
  runs: readonly WorkflowRun[],
): readonly WorkflowRun[] {
  const seen = new Set<string>();
  const unique: WorkflowRun[] = [];

  for (const run of runs) {
    const key = run.id || run.url;
    // Only dedupe on a real identity; runs with neither id nor url must not
    // collapse into a single empty-string key.
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    unique.push(run);
  }

  return unique.sort(
    (a, b) => sortableActivityTime(b) - sortableActivityTime(a),
  );
}

/**
 * Activity time for sorting, mapping undated runs (all timestamps null, so
 * {@link workflowActivityTime} is `NaN`) to a finite sentinel that sorts them
 * last and keeps the comparator total.
 */
function sortableActivityTime(run: WorkflowRun): number {
  const time = workflowActivityTime(run);
  return Number.isFinite(time) ? time : -1;
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
    headBranch: nullableStringValue(record.headBranch),
    headSha: nullableStringValue(record.headSha),
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
