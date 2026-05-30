import { Effect } from "effect";
import type {
  WorkflowRepoRuns,
  WorkflowRun,
  WorkflowRunQueryOptions,
  WorkflowState,
} from "../../types.js";
import { WorkflowRuns } from "../services/WorkflowRuns.js";
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
import { pipeRow } from "./rows.js";

const handleWorkflowError = Effect.catch((error: unknown) =>
  Effect.sync(() => {
    console.error(`[dot git-workflows] ${formatError(error)}`);
    process.exit(1);
  }),
);

/** CLI text output: --raw workflow summary. */
export const workflowsRaw = (opts?: WorkflowRunQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshWorkflowState(opts);
    yield* Effect.sync(() => process.stdout.write(formatRaw(state)));
  }).pipe(Effect.withSpan("workflows.raw"), handleWorkflowError);

/** Machine output: --waybar JSON. */
export const workflowsWaybar = (opts?: WorkflowRunQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshWorkflowState(opts);
    yield* Effect.sync(() =>
      process.stdout.write(JSON.stringify(formatWaybar(state)) + "\n"),
    );
  }).pipe(Effect.withSpan("workflows.waybar"), handleWorkflowError);

/** Machine output: --list-repos pipe-delimited repository rows. */
export const workflowsListRepos = (opts?: WorkflowRunQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshWorkflowState(opts);
    yield* Effect.sync(() => {
      for (const repo of state.repos) {
        process.stdout.write(formatRepoRow(repo) + "\n");
      }
    });
  }).pipe(Effect.withSpan("workflows.listRepos"), handleWorkflowError);

/** Machine output: --list-runs pipe-delimited workflow run rows. */
export const workflowsListRuns = (opts?: WorkflowRunQueryOptions) =>
  Effect.gen(function* () {
    const state = yield* refreshWorkflowState(opts);
    yield* Effect.sync(() => {
      for (const repo of state.repos) {
        for (const run of repo.runs) {
          process.stdout.write(formatRunRow(repo, run) + "\n");
        }
      }
    });
  }).pipe(Effect.withSpan("workflows.listRuns"), handleWorkflowError);

function refreshWorkflowState(opts?: WorkflowRunQueryOptions) {
  return Effect.gen(function* () {
    const workflows = yield* WorkflowRuns;
    yield* workflows.refresh(opts);
    return yield* workflows.getState();
  });
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

function formatWaybar(state: WorkflowState): {
  readonly text: string;
  readonly tooltip: string;
  readonly class: string;
} {
  const summary = workflowStateSummary(state);
  const text =
    summary.attentionCount > 0
      ? `\uf057 ${summary.attentionCount}`
      : summary.runningRuns > 0
        ? `\u25cf ${summary.runningRuns}`
        : "";
  const cls =
    summary.attentionCount === 0 && summary.runningRuns === 0
      ? "hidden"
      : summary.attentionCount > 0
        ? "workflows-attention"
        : "workflows-running";

  return {
    text,
    tooltip: formatWaybarTooltip(state, summary),
    class: cls,
  };
}

function formatWaybarTooltip(
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
  if (state.since) lines.push(`Since: ${state.since}`);
  if (state.message) lines.push(state.message);
  for (const repo of state.repos) {
    lines.push(`${repo.slug}: ${workflowRepoStatusText(repo)}`);
  }
  return lines.join("\n");
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
  if (error instanceof Error) return error.message;
  return String(error);
}
