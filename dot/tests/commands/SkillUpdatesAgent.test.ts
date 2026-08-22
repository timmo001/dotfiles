import { describe, expect, test } from "bun:test";
import {
  cleanSkillUpdateNames,
  isScopedSkillPatch,
  isShaOnlySkillPatch,
  latestSuccessfulWorkflowRun,
  skillUpdatesAgentModelArgument,
  skillUpdatesAgentPrompt,
  skillUpdatesAgentResultStatus,
  skillUpdateSubject,
  skillUpdatesWorkflowEndpoint,
  type SkillUpdatesAgentConfig,
} from "../../src/commands/SkillUpdatesAgent.js";

test("cleanSkillUpdateNames selects only automatic updates", () => {
  expect(
    cleanSkillUpdateNames([
      { name: "clean", state: "update-available" },
      { name: "adapted", state: "manual-review" },
      { name: "current", state: "up-to-date" },
    ]),
  ).toEqual(["clean"]);
});

const config: SkillUpdatesAgentConfig = {
  workflowApi: "https://api.github.com/example",
  dashboardIssue: "https://github.com/example/issues/1",
  repositories: ["/tmp/skills"],
  stateFile: "/tmp/last-run",
  opencodeCommand: "/usr/bin/opencode",
  opencodeAgent: "build",
  opencodeModels: [
    { providerID: "github-copilot", modelID: "gpt-test", variant: "low" },
  ],
  prompt: "Process the dashboard.",
};

describe("latestSuccessfulWorkflowRun", () => {
  test("selects the first successful workflow run", () => {
    expect(
      latestSuccessfulWorkflowRun({
        workflow_runs: [
          { id: 3, conclusion: "failure", html_url: "https://example/3" },
          { id: 2, conclusion: "success", html_url: "https://example/2" },
          { id: 1, conclusion: "success", html_url: "https://example/1" },
        ],
      }),
    ).toEqual({ id: 2, url: "https://example/2" });
  });

  test("returns null when no run succeeded", () => {
    expect(
      latestSuccessfulWorkflowRun({
        workflow_runs: [
          { id: 1, conclusion: "failure", html_url: "https://example/1" },
        ],
      }),
    ).toBeNull();
  });
});

test("skillUpdatesAgentModelArgument includes the configured variant", () => {
  expect(skillUpdatesAgentModelArgument(config.opencodeModels[0])).toBe(
    "github-copilot/gpt-test#low",
  );
});

test("skillUpdatesAgentPrompt appends trusted run context and status contract", () => {
  const prompt = skillUpdatesAgentPrompt(config, {
    id: 42,
    url: "https://github.com/example/actions/runs/42",
  });
  expect(prompt).toContain("Process the dashboard.");
  expect(prompt).toContain(config.dashboardIssue);
  expect(prompt).toContain("https://github.com/example/actions/runs/42");
  expect(prompt).toContain("STATUS: success");
});

describe("skillUpdatesAgentResultStatus", () => {
  test("rejects multiple status lines", () => {
    expect(
      skillUpdatesAgentResultStatus(
        "STATUS: failure\nfirst attempt\nSTATUS: success\ncomplete",
      ),
    ).toBeNull();
  });

  test("rejects output without the explicit status contract", () => {
    expect(skillUpdatesAgentResultStatus("Work complete")).toBeNull();
    expect(skillUpdatesAgentResultStatus("STATUS: success maybe")).toBeNull();
  });

  test("accepts one exact status line", () => {
    expect(skillUpdatesAgentResultStatus("STATUS: success\nComplete")).toBe(
      "success",
    );
  });
});

describe("isShaOnlySkillPatch", () => {
  const sha = "a".repeat(40);
  const previous = "b".repeat(40);

  test("accepts imports and frontmatter SHA changes", () => {
    expect(
      isShaOnlySkillPatch(
        [
          "diff --git a/example/SKILL.md b/example/SKILL.md",
          "index 1111111..2222222 100644",
          "--- a/example/SKILL.md",
          "+++ b/example/SKILL.md",
          "@@ -1 +1 @@",
          `-# upstream-sha: ${previous}`,
          `+# upstream-sha: ${sha}`,
          "diff --git a/imports.json b/imports.json",
          "index 3333333..4444444 100644",
          "--- a/imports.json",
          "+++ b/imports.json",
          "@@ -1 +1 @@",
          `-    "example": { "upstreamSha": "${previous}" },`,
          `+    "example": { "upstreamSha": "${sha}" },`,
        ].join("\n"),
        "example",
      ),
    ).toBe(true);
  });

  test("accepts clean upstream snapshot SHA changes", () => {
    expect(
      isShaOnlySkillPatch(
        [
          "diff --git a/upstream/example/UPSTREAM_SKILL.md b/upstream/example/UPSTREAM_SKILL.md",
          "--- a/upstream/example/UPSTREAM_SKILL.md",
          "+++ b/upstream/example/UPSTREAM_SKILL.md",
          "@@ -1 +1 @@",
          `-# upstream-sha: ${previous}`,
          `+# upstream-sha: ${sha}`,
          "diff --git a/imports.json b/imports.json",
          "--- a/imports.json",
          "+++ b/imports.json",
          "@@ -1 +1 @@",
          `-    "example": { "upstreamSha": "${previous}" },`,
          `+    "example": { "upstreamSha": "${sha}" },`,
        ].join("\n"),
        "example",
      ),
    ).toBe(true);
  });

  test("rejects skill content changes", () => {
    expect(
      isShaOnlySkillPatch(
        [
          "diff --git a/example/SKILL.md b/example/SKILL.md",
          "--- a/example/SKILL.md",
          "+++ b/example/SKILL.md",
          "@@ -1 +1 @@",
          "-Old guidance",
          "+New guidance",
        ].join("\n"),
        "example",
      ),
    ).toBe(false);
  });

  test("rejects metadata changes alongside the SHA", () => {
    const oldSha = "a".repeat(40);
    const newSha = "b".repeat(40);
    expect(
      isShaOnlySkillPatch(
        [
          "diff --git a/example/SKILL.md b/example/SKILL.md",
          "index 1111111..2222222 100644",
          "--- a/example/SKILL.md",
          "+++ b/example/SKILL.md",
          "@@ -1 +1 @@",
          `-# upstream-sha: ${oldSha}`,
          `+# upstream-sha: ${newSha}`,
          "diff --git a/imports.json b/imports.json",
          "index 3333333..4444444 100644",
          "--- a/imports.json",
          "+++ b/imports.json",
          "@@ -1 +1 @@",
          `-    "example": { "origin": "old", "upstreamSha": "${oldSha}" },`,
          `+    "example": { "origin": "new", "upstreamSha": "${newSha}" },`,
        ].join("\n"),
        "example",
      ),
    ).toBe(false);
  });

  test("rejects renamed skill files", () => {
    expect(
      isShaOnlySkillPatch(
        "diff --git a/example/SKILL.md b/renamed/SKILL.md",
        "example",
      ),
    ).toBe(false);
  });
});

describe("isScopedSkillPatch", () => {
  test("accepts content changes confined to one skill and its metadata", () => {
    expect(
      isScopedSkillPatch(
        [
          "diff --git a/example/SKILL.md b/example/SKILL.md",
          "-Old guidance",
          "+New guidance",
          "diff --git a/imports.json b/imports.json",
          '-    "upstreamSha": "old"',
          '+    "upstreamSha": "new"',
        ].join("\n"),
        "example",
      ),
    ).toBe(true);
  });

  test("rejects changes outside the named skill", () => {
    expect(
      isScopedSkillPatch(
        [
          "diff --git a/example/SKILL.md b/example/SKILL.md",
          "diff --git a/imports.json b/imports.json",
          "diff --git a/other/SKILL.md b/other/SKILL.md",
        ].join("\n"),
        "example",
      ),
    ).toBe(false);
  });

  test("rejects renamed files", () => {
    expect(
      isScopedSkillPatch(
        [
          "diff --git a/example/SKILL.md b/example/RENAMED.md",
          "diff --git a/imports.json b/imports.json",
        ].join("\n"),
        "example",
      ),
    ).toBe(false);
  });
});

describe("skillUpdateSubject", () => {
  test("labels SHA-only updates and keeps content update subjects", () => {
    const oldSha = "a".repeat(40);
    const newSha = "b".repeat(40);
    const shaPatch = [
      "diff --git a/example/SKILL.md b/example/SKILL.md",
      "--- a/example/SKILL.md",
      "+++ b/example/SKILL.md",
      "@@ -1 +1 @@",
      `-# upstream-sha: ${oldSha}`,
      `+# upstream-sha: ${newSha}`,
      "diff --git a/imports.json b/imports.json",
      "--- a/imports.json",
      "+++ b/imports.json",
      "@@ -1 +1 @@",
      `-    "example": { "upstreamSha": "${oldSha}" },`,
      `+    "example": { "upstreamSha": "${newSha}" },`,
    ].join("\n");
    expect(skillUpdateSubject(shaPatch, "example")).toBe(
      "[SHA-only] Update example",
    );
    expect(skillUpdateSubject("content changed", "example")).toBe(
      "Update skill: example",
    );
  });
});

describe("skillUpdatesWorkflowEndpoint", () => {
  test("converts a GitHub API URL to a gh endpoint", () => {
    expect(
      skillUpdatesWorkflowEndpoint(
        "https://api.github.com/repos/example/skills/actions/runs?status=completed",
      ),
    ).toBe("repos/example/skills/actions/runs?status=completed");
  });

  test("rejects non-GitHub API URLs", () => {
    expect(skillUpdatesWorkflowEndpoint("https://example.com/runs")).toBeNull();
  });
});
