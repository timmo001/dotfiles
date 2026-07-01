import type { WorkflowRepoRuns, WorkflowRun } from "../../types.js";
import { formatRelativeTimeAgo } from "./relativeTime.js";

/** Aggregated workflow run counts for one repository. */
export interface WorkflowRunCounts {
  /** Runs that are not completed yet. */
  readonly running: number;
  /** Completed runs whose conclusion needs attention. */
  readonly failed: number;
  /** Completed successful runs. */
  readonly passed: number;
  /** Completed skipped runs. */
  readonly skipped: number;
  /** Completed cancelled runs (not a failure). */
  readonly cancelled: number;
}

/** Repository-level workflow state derived from the run list. */
export type WorkflowRepoStatus =
  "error" | "not-loaded" | "running" | "mixed" | "failed" | "passed" | "quiet";

const REPO_STATUS_ICONS: Record<WorkflowRepoStatus, string> = {
  error: "\u00d7",
  "not-loaded": "\u25cb",
  running: "\u25cf",
  mixed: "\u25cf",
  failed: "\u00d7",
  passed: "\u2713",
  quiet: "\u25cb",
};

const COMPLETED_REPO_STATUS: Record<string, WorkflowRepoStatus> = {
  "0:0": "quiet",
  "0:1": "passed",
  "1:0": "failed",
  "1:1": "mixed",
};

/** Return true when a workflow run is still active. */
export function runRunning(run: WorkflowRun): boolean {
  return run.status !== "completed";
}

/** Return true when a completed workflow run passed. */
export function runPassed(run: WorkflowRun): boolean {
  return run.status === "completed" && run.conclusion === "success";
}

function runSkipped(run: WorkflowRun): boolean {
  return run.status === "completed" && run.conclusion === "skipped";
}

/** Return true when a completed workflow run was cancelled. */
export function runCancelled(run: WorkflowRun): boolean {
  return run.status === "completed" && run.conclusion === "cancelled";
}

/** Return true when a completed workflow run should be treated as failed. */
export function runFailed(run: WorkflowRun): boolean {
  return (
    run.status === "completed" &&
    run.conclusion !== "success" &&
    run.conclusion !== "skipped" &&
    run.conclusion !== "cancelled"
  );
}

/** Count running, failed, passed, skipped, and cancelled runs for one repository. */
export function workflowRunCounts(repo: WorkflowRepoRuns): WorkflowRunCounts {
  return {
    running: repo.runs.filter(runRunning).length,
    failed: repo.runs.filter(runFailed).length,
    passed: repo.runs.filter(runPassed).length,
    skipped: repo.runs.filter(runSkipped).length,
    cancelled: repo.runs.filter(runCancelled).length,
  };
}

/** Derive the repository-level status used by both TUI and CLI output. */
export function workflowRepoStatus(repo: WorkflowRepoRuns): WorkflowRepoStatus {
  const counts = workflowRunCounts(repo);
  const completedKey = `${Number(counts.failed > 0)}:${Number(counts.passed > 0)}`;
  const statuses = [
    statusWhen(Boolean(repo.error), "error"),
    statusWhen(!repo.headSha, "not-loaded"),
    statusWhen(counts.running > 0, "running"),
    COMPLETED_REPO_STATUS[completedKey],
  ];
  return statuses.find(isWorkflowRepoStatus) ?? "quiet";
}

/** Return the display icon for a repository workflow status. */
export function workflowRepoStatusIcon(repo: WorkflowRepoRuns): string {
  return REPO_STATUS_ICONS[workflowRepoStatus(repo)];
}

/** Return a concise repository workflow status label. */
export function workflowRepoStatusText(repo: WorkflowRepoRuns): string {
  const directStatus = [
    textWhen(Boolean(repo.error), `error: ${repo.error ?? "unknown"}`),
    textWhen(!repo.headSha, "not loaded"),
    textWhen(repo.runs.length === 0, "no runs for head commit"),
  ];
  return (
    directStatus.find(isString) ??
    workflowRunCountsText(workflowRunCounts(repo))
  );
}

/** Return the display icon for an individual workflow run. */
export function workflowRunStatusIcon(run: WorkflowRun): string {
  if (runRunning(run)) return "\u25cf";
  if (runPassed(run)) return "\u2713";
  if (runCancelled(run)) return "\u25cb";
  return runSkipped(run) ? "\u25cb" : "\u00d7";
}

/** Return a concise workflow run status label. */
function workflowRunStatusText(run: WorkflowRun): string {
  if (runRunning(run)) return run.status.replace(/_/g, " ");
  return run.conclusion ?? "completed";
}

/** Return the display text for a repository's current checkout and workflow summary. */
export function formatWorkflowRepoDetail(repo: WorkflowRepoRuns): string {
  const branch = repo.branch ?? "current branch";
  const commit = repo.headSha
    ? `${branch}@${shortWorkflowSha(repo.headSha)}`
    : branch;
  const subject = repo.commitSubject ? ` • ${repo.commitSubject}` : "";
  return `${commit} • ${workflowRepoStatusText(repo)}${subject}`;
}

/** Return the display text for one workflow run. */
export function formatWorkflowRunDetail(run: WorkflowRun): string {
  const event = run.event ? ` • ${run.event}` : "";
  const when = formatWorkflowTimeAgo(
    run.updatedAt ?? run.startedAt ?? run.createdAt,
  );
  return `${workflowRunStatusText(run)}${event} • ${when} • ${run.displayTitle}`;
}

/** Return a compact relative timestamp for workflow UI and CLI output. */
export function formatWorkflowTimeAgo(value: string | null): string {
  return formatRelativeTimeAgo(value);
}

function workflowRunCountsText(counts: WorkflowRunCounts): string {
  const parts = [
    countText(counts.running, "running"),
    countText(counts.failed, "failed"),
    countText(counts.passed, "passed"),
    countText(counts.skipped, "skipped"),
    countText(counts.cancelled, "cancelled"),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : "no completed runs";
}

function countText(count: number, label: string): string | null {
  return count > 0 ? `${count} ${label}` : null;
}

function statusWhen(
  condition: boolean,
  status: WorkflowRepoStatus,
): WorkflowRepoStatus | null {
  return condition ? status : null;
}

function textWhen(condition: boolean, text: string): string | null {
  return condition ? text : null;
}

function isWorkflowRepoStatus(
  value: WorkflowRepoStatus | null | undefined,
): value is WorkflowRepoStatus {
  return value !== null && value !== undefined;
}

function isString(value: string | null): value is string {
  return value !== null;
}

function shortWorkflowSha(sha: string): string {
  return sha.slice(0, 7);
}
