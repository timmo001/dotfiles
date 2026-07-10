import { describe, expect, test } from "bun:test";
import type { WorkflowRepoRuns, WorkflowRun } from "../../../src/types.js";
import {
  formatWorkflowRepoDetail,
  runCancelled,
  runFailed,
  runPassed,
  runRunning,
  workflowRepoStatus,
  workflowRepoStatusText,
  workflowRunCounts,
  workflowRunStatusIcon,
} from "../../../src/git/services/workflowStatus.js";

const run = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: "1",
  workflowId: "10",
  workflowName: "CI",
  displayTitle: "Build",
  status: "completed",
  conclusion: "success",
  url: "https://github.com/owner/repo/actions/runs/1",
  event: "push",
  createdAt: "2026-07-10T12:00:00.000Z",
  startedAt: null,
  updatedAt: null,
  ...overrides,
});

const repo = (overrides: Partial<WorkflowRepoRuns> = {}): WorkflowRepoRuns => ({
  slug: "owner/repo",
  branch: "main",
  headSha: "0123456789abcdef",
  commitSubject: "Test workflows",
  commitUrl: "https://github.com/owner/repo/commit/0123456789abcdef",
  runs: [],
  ...overrides,
});

describe("workflow run status", () => {
  test("classifies terminal and active runs", () => {
    expect(runRunning(run({ status: "queued", conclusion: null }))).toBe(true);
    expect(runPassed(run())).toBe(true);
    expect(runCancelled(run({ conclusion: "cancelled" }))).toBe(true);
    expect(runFailed(run({ conclusion: "failure" }))).toBe(true);
    expect(runFailed(run({ conclusion: "skipped" }))).toBe(false);
    expect(runFailed(run({ conclusion: "cancelled" }))).toBe(false);
  });

  test("counts each run category", () => {
    expect(
      workflowRunCounts(
        repo({
          runs: [
            run({ status: "queued", conclusion: null }),
            run({ conclusion: "failure" }),
            run(),
            run({ conclusion: "skipped" }),
            run({ conclusion: "cancelled" }),
          ],
        }),
      ),
    ).toEqual({ running: 1, failed: 1, passed: 1, skipped: 1, cancelled: 1 });
  });

  test.each([
    [repo({ error: "offline" }), "error"],
    [repo({ headSha: null }), "not-loaded"],
    [repo({ runs: [run({ status: "queued", conclusion: null })] }), "running"],
    [repo({ runs: [run(), run({ conclusion: "failure" })] }), "mixed"],
    [repo({ runs: [run({ conclusion: "failure" })] }), "failed"],
    [repo({ runs: [run()] }), "passed"],
    [repo(), "quiet"],
  ] as const)("derives repository status", (value, expected) => {
    expect(workflowRepoStatus(value)).toBe(expected);
  });

  test("formats repository status and checkout detail", () => {
    const value = repo({ runs: [run(), run({ conclusion: "skipped" })] });
    expect(workflowRepoStatusText(value)).toBe("1 passed, 1 skipped");
    expect(formatWorkflowRepoDetail(value)).toBe(
      "main@0123456 • 1 passed, 1 skipped • Test workflows",
    );
  });

  test("formats individual run icons", () => {
    expect(
      workflowRunStatusIcon(run({ status: "queued", conclusion: null })),
    ).toBe("●");
    expect(workflowRunStatusIcon(run())).toBe("✓");
    expect(workflowRunStatusIcon(run({ conclusion: "cancelled" }))).toBe("○");
    expect(workflowRunStatusIcon(run({ conclusion: "failure" }))).toBe("×");
  });
});
