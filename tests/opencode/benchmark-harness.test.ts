import { describe, expect, test } from "bun:test";
import {
  aggregateReport,
  extractFinalText,
  parseRunEvents,
  scoreRun,
  type RunEvidence,
  type RunEvent,
  type RunRecord,
} from "../../.benchmarks/opencode/benchmark";
import {
  PINNED_COMMIT,
  type BenchmarkScenario,
} from "../../.benchmarks/opencode/scenarios";

const scenario = {
  id: "test",
  title: "Test scenario",
  mode: "implementation",
  prompt: "Make the change",
  sourcePaths: ["src/target.ts", "src/consumer.ts"],
  requiredChangedPaths: ["src/target.ts"],
  allowedChangedPaths: ["src/target.ts", "src/consumer.ts"],
  forbiddenChangedPaths: ["src/unrelated.ts"],
  requiredDiffText: ["expectedChange()"],
  forbiddenDiffText: ["wrongChange()"],
  expectedFindings: "none",
} satisfies BenchmarkScenario;

const evidence = (overrides: Partial<RunEvidence> = {}): RunEvidence => ({
  exitCode: 0,
  timedOut: false,
  events: [],
  stderr: "",
  finalText: "Implemented the requested change.",
  workspacePath: "/tmp/fixture/workspace",
  baselineChangedPaths: [],
  changedPaths: ["src/target.ts"],
  diff: "diff --git a/src/target.ts b/src/target.ts\n+expectedChange()",
  beforeTree: "before",
  afterTree: "after",
  workspaceRemoved: true,
  canonicalCommit: PINNED_COMMIT,
  ...overrides,
});

const tool = (name: string, input: unknown): RunEvent => ({
  type: "tool_use",
  part: {
    type: "tool",
    tool: name,
    state: { status: "completed", input },
  },
});

describe("OpenCode benchmark event capture", () => {
  test("parses NDJSON and extracts completed text in order", () => {
    const events = parseRunEvents(
      [
        JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
        JSON.stringify({ type: "text", part: { type: "text", text: "First" } }),
        JSON.stringify({
          type: "text",
          part: { type: "text", text: "Second" },
        }),
      ].join("\n"),
    );

    expect(extractFinalText(events)).toBe("First\n\nSecond");
  });

  test("rejects malformed event lines", () => {
    expect(() => parseRunEvents('{"type":"text"}\nnot-json')).toThrow("line 2");
  });
});

describe("OpenCode benchmark deterministic scoring", () => {
  test("accepts a contained implementation run", () => {
    expect(scoreRun(scenario, evidence()).passed).toBe(true);
  });

  test("rejects missing required and unexpected changed paths", () => {
    const result = scoreRun(
      scenario,
      evidence({ changedPaths: ["src/unrelated.ts"] }),
    );

    expect(result.passed).toBe(false);
    expect(
      result.checks.filter((check) => !check.passed).map((check) => check.name),
    ).toEqual([
      "required paths changed",
      "changed paths allowed",
      "forbidden paths unchanged",
    ]);
  });

  test("rejects path-only edits that do not implement the expected change", () => {
    expect(
      scoreRun(scenario, evidence({ diff: "+unrelatedChange()" })).passed,
    ).toBe(false);
  });

  test.each([
    ["webfetch", { url: "https://example.com/answer" }],
    ["bash", { command: "curl https://example.com" }],
    ["grep", { path: "/tmp/run/.benchmarks/opencode/scenarios.ts" }],
    ["read", { filePath: "../outer/expected-results.json" }],
    ["read", { filePath: "/tmp/fixture/workspace/.git/HEAD" }],
    ["read", { filePath: "/home/user/expected-results.json" }],
  ])("rejects cheating evidence from %s", (name, input) => {
    expect(
      scoreRun(scenario, evidence({ events: [tool(name, input)] })).passed,
    ).toBe(false);
  });

  test("requires an explicit empty review and an unchanged tree", () => {
    const review = {
      ...scenario,
      mode: "review",
      requiredChangedPaths: [],
      allowedChangedPaths: [],
      forbiddenChangedPaths: ["src/target.ts"],
      requiredDiffText: [],
      forbiddenDiffText: [],
      expectedFindings: "none",
    } satisfies BenchmarkScenario;

    expect(
      scoreRun(
        review,
        evidence({
          changedPaths: ["src/target.ts"],
          baselineChangedPaths: ["src/target.ts"],
          beforeTree: "same",
          afterTree: "same",
          finalText: "No scoped findings were found.",
        }),
      ).passed,
    ).toBe(true);
    expect(
      scoreRun(
        review,
        evidence({
          baselineChangedPaths: ["src/target.ts"],
          changedPaths: ["src/target.ts"],
          beforeTree: "same",
          afterTree: "different",
          finalText: "No scoped findings were found.",
        }),
      ).passed,
    ).toBe(false);
  });

  test("requires expected review findings to cite the changed path and text", () => {
    const review = {
      ...scenario,
      mode: "review",
      requiredChangedPaths: [],
      allowedChangedPaths: [],
      forbiddenChangedPaths: ["src/target.ts"],
      requiredDiffText: [],
      forbiddenDiffText: [],
      expectedFindings: [
        { path: "src/target.ts", changedText: "unsafeCall(value)" },
      ],
    } satisfies BenchmarkScenario;

    expect(
      scoreRun(
        review,
        evidence({
          changedPaths: [],
          baselineChangedPaths: [],
          beforeTree: "same",
          afterTree: "same",
          finalText:
            "src/target.ts:12 calls unsafeCall(value), which breaks the changed contract.",
        }),
      ).passed,
    ).toBe(true);
  });
});

describe("OpenCode benchmark aggregation", () => {
  test("reports repeat variance without changing individual results", () => {
    const records = [true, false].map(
      (passed, index) =>
        ({
          scenario: "test",
          repeat: index + 1,
          mode: "implementation",
          elapsedMs: 10,
          evidence: evidence(),
          result: { passed, checks: [] },
        }) satisfies RunRecord,
    );

    expect(aggregateReport(records)).toMatchObject({
      passed: false,
      passedRuns: 1,
      totalRuns: 2,
    });
  });
});
