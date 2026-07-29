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
  agent: "refactorer",
  requiredSkills: ["changeset-scope", "effect-principles"],
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
  events: [
    {
      type: "tool_use",
      part: {
        type: "tool",
        tool: "skill",
        state: { status: "completed", input: { name: "changeset-scope" } },
      },
    },
    {
      type: "tool_use",
      part: {
        type: "tool",
        tool: "skill",
        state: { status: "completed", input: { name: "effect-principles" } },
      },
    },
  ],
  stderr: "",
  finalText: "Implemented the requested change.",
  agent: "refactorer",
  agentSourceHash: "agent-hash",
  expectedAgentSourceHash: "agent-hash",
  skillSourceHashes: {
    "changeset-scope": "scope-hash",
    "effect-principles": "principles-hash",
  },
  expectedSkillSourceHashes: {
    "changeset-scope": "scope-hash",
    "effect-principles": "principles-hash",
  },
  workspacePath: "/tmp/fixture/workspace",
  baselineChangedPaths: [],
  changedPaths: ["src/target.ts"],
  diff: "diff --git a/src/target.ts b/src/target.ts\n+expectedChange()",
  beforeTree: "before",
  afterTree: "after",
  workspaceRemoved: true,
  canonicalCommit: PINNED_COMMIT,
  contextAudit: {
    captured: true,
    systemChars: 1200,
    toolChars: 800,
    toolDefinitionCalls: 3,
    uniqueTools: 2,
    repeatedToolDefinitions: [{ name: "skill", chars: 2 }],
    totalStarterChars: 2000,
    estimatedStarterTokens: 500,
    systemSegments: [{ name: "skill-catalogue", chars: 1200 }],
    largestTools: [{ name: "skill", chars: 800 }],
    loadedSkillChars: 600,
    estimatedLoadedSkillTokens: 150,
    loadedSkills: [
      { name: "changeset-scope", chars: 400 },
      { name: "effect-principles", chars: 200 },
    ],
    unmeasuredLoadedSkills: [],
    duplicateGuidance: [],
  },
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

  test("rejects the wrong agent source and missing scope skill", () => {
    const result = scoreRun(
      scenario,
      evidence({
        agent: "reviewer",
        agentSourceHash: "different",
        events: [],
      }),
    );

    expect(
      result.checks.filter((check) => !check.passed).map((check) => check.name),
    ).toEqual([
      "shipped agent source loaded",
      "required skills loaded",
      "scope skill loaded first",
      "engineering baseline loaded after scope",
    ]);
  });

  test("rejects a run without starter-context evidence", () => {
    const result = scoreRun(
      scenario,
      evidence({
        contextAudit: {
          ...evidence().contextAudit,
          captured: false,
        },
      }),
    );

    expect(
      result.checks.find((check) => check.name === "starter context captured")
        ?.passed,
    ).toBe(false);
  });

  test("rejects a coding skill loaded before changeset-scope", () => {
    const review = {
      ...scenario,
      mode: "review",
      agent: "reviewer",
      requiredSkills: ["changeset-scope", "effect-principles", "code-review"],
      requiredChangedPaths: [],
      allowedChangedPaths: [],
      forbiddenChangedPaths: ["src/target.ts"],
      requiredDiffText: [],
      forbiddenDiffText: [],
      expectedFindings: "none",
    } satisfies BenchmarkScenario;

    const result = scoreRun(
      review,
      evidence({
        agent: "reviewer",
        events: [
          tool("skill", { name: "code-review" }),
          tool("skill", { name: "changeset-scope" }),
          tool("skill", { name: "effect-principles" }),
        ],
        changedPaths: ["src/target.ts"],
        baselineChangedPaths: ["src/target.ts"],
        beforeTree: "same",
        afterTree: "same",
        finalText: "No scoped findings were found.",
      }),
    );

    expect(
      result.checks.find((check) => check.name === "scope skill loaded first")
        ?.passed,
    ).toBe(false);
  });

  test("rejects a specialist loaded before the engineering baseline", () => {
    const result = scoreRun(
      {
        ...scenario,
        requiredSkills: [
          "changeset-scope",
          "effect-principles",
          "types-enforce-ts",
        ],
      },
      evidence({
        events: [
          tool("skill", { name: "changeset-scope" }),
          tool("skill", { name: "types-enforce-ts" }),
          tool("skill", { name: "effect-principles" }),
        ],
        skillSourceHashes: {
          "changeset-scope": "scope-hash",
          "effect-principles": "principles-hash",
          "types-enforce-ts": "types-hash",
        },
        expectedSkillSourceHashes: {
          "changeset-scope": "scope-hash",
          "effect-principles": "principles-hash",
          "types-enforce-ts": "types-hash",
        },
      }),
    );

    expect(
      result.checks.find(
        (check) => check.name === "engineering baseline loaded after scope",
      )?.passed,
    ).toBe(false);
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
          scenario: "implementation-required-consumer",
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
      contextAudit: {
        capturedRuns: 2,
        maxStarterChars: 2000,
        maxEstimatedStarterTokens: 500,
        maxLoadedSkillChars: 600,
        maxEstimatedLoadedSkillTokens: 150,
      },
    });
  });

  test("deduplicates repeated guidance findings across runs", () => {
    const duplicate = {
      text: "preserve the same behaviour across the requested changeset",
      skills: ["effect-principles", "types-enforce-ts"],
    };
    const records = [1, 2].map(
      (repeat) =>
        ({
          scenario: "implementation-required-consumer",
          repeat,
          mode: "implementation",
          elapsedMs: 10,
          evidence: evidence({
            contextAudit: {
              ...evidence().contextAudit,
              duplicateGuidance: [duplicate],
            },
          }),
          result: { passed: true, checks: [] },
        }) satisfies RunRecord,
    );

    expect(aggregateReport(records).contextAudit.duplicateGuidance).toEqual([
      duplicate,
    ]);
  });
});
