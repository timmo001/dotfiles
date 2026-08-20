import { describe, expect, test } from "bun:test";
import {
  latestSuccessfulWorkflowRun,
  skillUpdatesAgentModelArgument,
  skillUpdatesAgentPrompt,
  skillUpdatesAgentResultStatus,
  skillUpdatesWorkflowEndpoint,
  type SkillUpdatesAgentConfig,
} from "../../src/commands/SkillUpdatesAgent.js";

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
  test("uses the final status line", () => {
    expect(
      skillUpdatesAgentResultStatus(
        "STATUS: failure\nfirst attempt\nSTATUS: success\ncomplete",
      ),
    ).toBe("success");
  });

  test("rejects output without the explicit status contract", () => {
    expect(skillUpdatesAgentResultStatus("Work complete")).toBeNull();
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
