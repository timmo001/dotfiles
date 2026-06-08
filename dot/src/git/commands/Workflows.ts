import { Effect } from "effect";
import { existsSync } from "node:fs";
import type {
  WorkflowRepoRuns,
  WorkflowRun,
  WorkflowRunQueryOptions,
  WorkflowRunStatus,
  WorkflowState,
} from "../../types.js";
import {
  CommandExecutor,
  type CommandExecutorService,
} from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import {
  activeGitReposForCheck,
  type GitManagedRepo,
} from "../../services/GitConfig.js";
import { GitHub, type GitHubService } from "../services/GitHub.js";
import { WorkflowRuns } from "../services/WorkflowRuns.js";
import {
  textLooksLikeBotActivity,
  valuesLookLikeBotActivity,
} from "../services/botActivity.js";
import { managedRepoGitHubSlugs } from "../services/repoRelations.js";
import {
  nullableIdValue,
  nullableStringValue,
  stringValue,
} from "../services/record.js";
import {
  formatWorkflowRepoDetail,
  formatWorkflowRunDetail,
  formatWorkflowTimeAgo,
  workflowRepoStatus,
  workflowRepoStatusIcon,
  workflowRepoStatusText,
  workflowRunCounts,
  workflowRunStatusIcon,
} from "../services/workflowStatus.js";
import {
  formatCommandError,
  handleCommandError,
  pipeRow,
  writeJsonLine,
  writeRows,
  writeText,
} from "./rows.js";

const BAR_BRANCH_RUN_LIMIT = 20;

const handleWorkflowError = handleCommandError("dot git-workflows");

/** CLI text output: --raw workflow summary. */
export const workflowsRaw = (opts?: WorkflowRunQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshWorkflowState(opts);
    yield* writeText(formatRaw(state));
  }).pipe(Effect.withSpan("workflows.raw"), handleWorkflowError);

/** Machine output: status bar JSON. */
export const workflowsBarJson = (opts?: WorkflowRunQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshWorkflowBarState(opts);
    yield* writeJsonLine(formatBarJson(state));
  }).pipe(Effect.withSpan("workflows.barJson"), handleWorkflowError);

interface GhBarRunRecord {
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

/** Machine output: --list-repos pipe-delimited repository rows. */
export const workflowsListRepos = (opts?: WorkflowRunQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshWorkflowState(opts);
    yield* writeRows(state.repos.map(formatRepoRow));
  }).pipe(Effect.withSpan("workflows.listRepos"), handleWorkflowError);

/** Machine output: --list-runs pipe-delimited workflow run rows. */
export const workflowsListRuns = (opts?: WorkflowRunQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshWorkflowState(opts);
    yield* writeRows(
      state.repos.flatMap((repo) =>
        repo.runs.map((run) => formatRunRow(repo, run)),
      ),
    );
  }).pipe(Effect.withSpan("workflows.listRuns"), handleWorkflowError);

function refreshWorkflowState(opts?: WorkflowRunQueryOptions) {
  return Effect.gen(function* () {
    const workflows = yield* WorkflowRuns;
    yield* workflows.refresh(opts);
    return yield* workflows.getState();
  });
}

function refreshWorkflowBarState(opts?: WorkflowRunQueryOptions) {
  return Effect.gen(function* () {
    const config = yield* Config;
    if (!config.canUsePrivate) {
      return emptyState(
        opts,
        `Skipping workflow config (${config.privateReason})`,
      );
    }
    if (!config.gitConfig.valid) {
      return emptyState(opts, config.gitConfig.diagnostics.join("; "));
    }

    const github = yield* GitHub;
    if (!(yield* github.isAvailable())) {
      return emptyState(opts, "gh CLI not found");
    }

    const executor = yield* CommandExecutor;
    const repos = yield* Effect.all(
      activeGitReposForCheck(config.gitConfig, "workflows").map((repo) =>
        loadWorkflowBarRepo(repo, opts, github, executor),
      ),
      { concurrency: 4 },
    );

    return {
      repos,
      lastChecked: new Date(),
      loading: false,
      loaded: true,
      since: opts?.since ?? null,
    } satisfies WorkflowState;
  });
}

function loadWorkflowBarRepo(
  repo: GitManagedRepo,
  opts: WorkflowRunQueryOptions | undefined,
  github: GitHubService,
  executor: CommandExecutorService,
) {
  return Effect.gen(function* () {
    if (!existsSync(repo.path)) {
      return {
        ...emptyRepo(repo.github),
        error: "local checkout not found from dot-git.yml",
      };
    }

    const branches = yield* localBranches(repo.path, executor);
    if (branches.length === 0) return emptyRepo(repo.github);

    const slugs = yield* managedRepoGitHubSlugs(repo, executor);
    const slugRuns = yield* Effect.all(
      slugs.map((slug) => workflowRunsForSlug(slug, branches, opts, github)),
      { concurrency: 2 },
    );
    const runs = uniqueWorkflowRuns(slugRuns.flat()).filter((run) =>
      workflowRunMatchesSince(run, opts?.since),
    );
    const filteredRuns = repo.notifications.bar.ignoreBotActivity
      ? yield* Effect.all(
          runs.map((run) => workflowRunVisible(run, repo.path, executor)),
          { concurrency: 4 },
        ).pipe(
          Effect.map((results) =>
            results
              .filter((result) => result.visible)
              .map((result) => result.run),
          ),
        )
      : runs;
    const firstRun = filteredRuns[0];

    return {
      slug: repo.github,
      branch: branches.length === 1 ? branches[0] : "multiple branches",
      headSha: firstRun?.headSha ?? null,
      commitSubject: null,
      commitUrl: firstRun?.headSha
        ? `https://github.com/${repo.github}/commit/${firstRun.headSha}`
        : null,
      runs: filteredRuns,
    } satisfies WorkflowRepoRuns;
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed({
        ...emptyRepo(repo.github),
        error: formatError(error),
      }),
    ),
  );
}

function workflowRunsForSlug(
  slug: string,
  branches: readonly string[],
  opts: WorkflowRunQueryOptions | undefined,
  github: GitHubService,
) {
  return Effect.gen(function* () {
    const workflowIds = yield* fetchActiveWorkflowIds(slug, github);
    const branchRuns = yield* Effect.all(
      branches.map((branch) => branchWorkflowRuns(slug, branch, opts, github)),
      { concurrency: 2 },
    );
    return uniqueWorkflowRuns(branchRuns.flat()).filter((run) =>
      workflowRunMatchesActiveWorkflow(run, workflowIds),
    );
  });
}

function localBranches(repoPath: string, executor: CommandExecutorService) {
  return executor
    .run("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
      cwd: repoPath,
    })
    .pipe(
      Effect.map((output) =>
        output
          .split("\n")
          .map((branch) => branch.trim())
          .filter((branch) => branch.length > 0),
      ),
      Effect.catch(() => Effect.succeed([])),
    );
}

function fetchActiveWorkflowIds(slug: string, github: GitHubService) {
  return github
    .json([
      "workflow",
      "list",
      "--repo",
      slug,
      "--all",
      "--limit",
      "1000",
      "--json",
      "id,state",
    ])
    .pipe(
      Effect.map(
        (parsed) =>
          new Set(
            Array.isArray(parsed)
              ? parsed
                  .filter(isWorkflowRecord)
                  .filter((record) => record.state === "active")
                  .map((record) => nullableIdValue(record.id))
                  .filter((id): id is string => id !== null)
              : [],
          ),
      ),
      Effect.catch(() => Effect.succeed(null)),
    );
}

function branchWorkflowRuns(
  slug: string,
  branch: string,
  opts: WorkflowRunQueryOptions | undefined,
  github: GitHubService,
) {
  return github
    .json([
      "run",
      "list",
      "--repo",
      slug,
      "--branch",
      branch,
      "--limit",
      String(BAR_BRANCH_RUN_LIMIT),
      "--json",
      "databaseId,workflowDatabaseId,status,conclusion,workflowName,displayTitle,url,event,createdAt,startedAt,updatedAt,headBranch,headSha",
    ])
    .pipe(
      Effect.map((parsed) =>
        Array.isArray(parsed)
          ? parsed
              .filter(isBarRunRecord)
              .map(toBarWorkflowRun)
              .filter((run) => workflowRunMatchesSince(run, opts?.since))
          : [],
      ),
      Effect.catch(() => Effect.succeed([])),
    );
}

function workflowRunVisible(
  run: WorkflowRun,
  repoPath: string,
  executor: CommandExecutorService,
) {
  return Effect.gen(function* () {
    if (
      valuesLookLikeBotActivity([
        run.headBranch,
        run.displayTitle,
        run.workflowName,
        run.event,
      ])
    ) {
      return { run, visible: false };
    }

    if (!run.headSha) return { run, visible: true };
    const author = yield* executor
      .run("git", ["show", "-s", "--pretty=%an <%ae>", run.headSha], {
        cwd: repoPath,
      })
      .pipe(Effect.catch(() => Effect.succeed(null)));
    return {
      run,
      visible: author === null || !textLooksLikeBotActivity(author),
    };
  });
}

function uniqueWorkflowRuns(
  runs: readonly WorkflowRun[],
): readonly WorkflowRun[] {
  const seen = new Set<string>();
  const unique: WorkflowRun[] = [];
  for (const run of runs) {
    const key = run.id || run.url;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(run);
  }
  return unique.sort((a, b) => workflowRunTime(b) - workflowRunTime(a));
}

function emptyState(
  opts: WorkflowRunQueryOptions | undefined,
  message: string,
): WorkflowState {
  return {
    repos: [],
    lastChecked: new Date(),
    loading: false,
    loaded: true,
    since: opts?.since ?? null,
    message,
  };
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

function formatRaw(state: WorkflowState): string {
  const lines: string[] = [
    "Workflow Runs",
    `Last checked: ${formatWorkflowTimeAgo(state.lastChecked.toISOString())}`,
  ];
  if (state.since) lines.push(`Since: ${state.since}`);
  if (state.message) lines.push(`Message: ${state.message}`);
  if (state.repos.length === 0) {
    lines.push("", "No watched workflow repositories configured.");
    return lines.join("\n") + "\n";
  }

  for (const repo of state.repos) {
    lines.push("", `${workflowRepoStatusIcon(repo)} ${repo.slug}`);
    lines.push(`  ${formatWorkflowRepoDetail(repo)}`);
    if (repo.runs.length === 0) continue;

    for (const run of repo.runs) {
      lines.push(
        `  ${workflowRunStatusIcon(run)} ${run.workflowName}: ${formatWorkflowRunDetail(run)}`,
      );
    }
  }

  return lines.join("\n") + "\n";
}

function formatBarJson(state: WorkflowState): {
  readonly text: string;
  readonly tooltip: string;
  readonly class: string;
} {
  const summary = workflowStateSummary(state);

  return {
    text: workflowBarText(summary),
    tooltip: formatBarJsonTooltip(state, summary),
    class: workflowBarClass(summary),
  };
}

function workflowBarText(
  summary: ReturnType<typeof workflowStateSummary>,
): string {
  if (summary.attentionCount > 0) return `\uf057 ${summary.attentionCount}`;
  return "";
}

function workflowBarClass(
  summary: ReturnType<typeof workflowStateSummary>,
): string {
  if (summary.attentionCount > 0) return "workflows-attention";
  return "hidden";
}

function formatBarJsonTooltip(
  state: WorkflowState,
  summary: ReturnType<typeof workflowStateSummary>,
): string {
  if (state.repos.length === 0) {
    return (
      state.message ?? "GitHub workflows: no watched repositories configured."
    );
  }

  const lines = [
    `GitHub workflows: ${summary.failedRuns} failed, ${summary.errorRepos} repo errors, ${summary.runningRuns} running, ${summary.passedRuns} passed, ${summary.skippedRuns} skipped.`,
  ];
  appendWorkflowQueryLines(lines, state);
  appendWorkflowRepoLines(lines, state.repos);
  return lines.join("\n");
}

function appendWorkflowQueryLines(lines: string[], state: WorkflowState): void {
  if (state.since) lines.push(`Since: ${state.since}`);
  if (state.message) lines.push(state.message);
}

function appendWorkflowRepoLines(
  lines: string[],
  repos: readonly WorkflowRepoRuns[],
): void {
  for (const repo of repos) {
    lines.push(`${repo.slug}: ${workflowRepoStatusText(repo)}`);
  }
}

function workflowStateSummary(state: WorkflowState): {
  readonly errorRepos: number;
  readonly failedRuns: number;
  readonly runningRuns: number;
  readonly passedRuns: number;
  readonly skippedRuns: number;
  readonly attentionCount: number;
} {
  let errorRepos = 0;
  let failedRuns = 0;
  let runningRuns = 0;
  let passedRuns = 0;
  let skippedRuns = 0;

  for (const repo of state.repos) {
    if (repo.error) errorRepos += 1;
    const counts = workflowRunCounts(repo);
    failedRuns += counts.failed;
    runningRuns += counts.running;
    passedRuns += counts.passed;
    skippedRuns += counts.skipped;
  }

  return {
    errorRepos,
    failedRuns,
    runningRuns,
    passedRuns,
    skippedRuns,
    attentionCount: errorRepos + failedRuns,
  };
}

function isBarRunRecord(value: unknown): value is GhBarRunRecord {
  return isRecord(value);
}

function isWorkflowRecord(value: unknown): value is GhWorkflowRecord {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toBarWorkflowRun(record: GhBarRunRecord): WorkflowRun {
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
    status: normalizeWorkflowStatus(stringValue(record.status)),
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

function workflowRunMatchesActiveWorkflow(
  run: WorkflowRun,
  activeWorkflowIds: ReadonlySet<string> | null,
): boolean {
  return (
    activeWorkflowIds === null ||
    run.workflowId === null ||
    activeWorkflowIds.has(run.workflowId)
  );
}

function workflowRunMatchesSince(
  run: WorkflowRun,
  since: string | undefined,
): boolean {
  if (!since) return true;
  const sinceAt = Date.parse(since);
  return Number.isFinite(sinceAt) && workflowRunTime(run) >= sinceAt;
}

function workflowRunTime(run: WorkflowRun): number {
  return Math.max(
    parseWorkflowTime(run.createdAt),
    parseWorkflowTime(run.startedAt),
    parseWorkflowTime(run.updatedAt),
  );
}

function parseWorkflowTime(value: string | null): number {
  return value ? Date.parse(value) : NaN;
}

function normalizeWorkflowStatus(status: string): WorkflowRunStatus {
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

function formatRepoRow(repo: WorkflowRepoRuns): string {
  const counts = workflowRunCounts(repo);
  return pipeRow([
    repo.slug,
    workflowRepoStatus(repo),
    repo.branch,
    repo.headSha,
    String(counts.running),
    String(counts.failed),
    String(counts.passed),
    String(counts.skipped),
    workflowRepoStatusText(repo),
  ]);
}

function formatRunRow(repo: WorkflowRepoRuns, run: WorkflowRun): string {
  return pipeRow([
    repo.slug,
    repo.branch,
    repo.headSha,
    run.status,
    run.conclusion,
    run.workflowName,
    run.url,
    run.displayTitle,
  ]);
}

function formatError(error: unknown): string {
  return formatCommandError(error);
}
