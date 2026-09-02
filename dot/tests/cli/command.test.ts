import { describe, expect, test } from "bun:test";
import type { Command } from "effect/unstable/cli";
import {
  commandHelp,
  commandNames,
  dotCommand,
  getCliCommand,
  normalizeCliArgs,
} from "../../src/cli/spec.js";
import { renderCompletions } from "../../src/commands/Completions.js";

function nestedCommand(...path: readonly string[]) {
  let command: Command.Command.Any = dotCommand;
  for (const name of path) {
    const nested = command.subcommands
      .flatMap((group) => group.commands)
      .find((item) => item.name === name);
    if (!nested) throw new Error(`Command missing: ${path.join(" ")}`);
    command = nested;
  }
  return command;
}

describe("Effect command tree", () => {
  test("owns canonical commands and aliases", () => {
    expect(commandNames).toContain("update");
    expect(commandNames).toContain("agent-oxlint");
    expect(commandNames).toContain("skills");
    expect(commandNames).not.toContain("skill-updates");
    expect(commandNames).not.toContain("skill-check");
    expect(commandNames).not.toContain("skill-updates-agent");
    expect(getCliCommand("up")?.name).toBe("update");
    expect(getCliCommand("diff")?.name).toBe("git-diff");
  });

  test("builds nested and typed help", () => {
    const notifications = getCliCommand("git-notifications");
    expect(notifications).toBeDefined();
    if (!notifications) throw new Error("git-notifications command missing");
    const help = commandHelp(notifications, ["dot", "git-notifications"]);
    expect(help.usage).toContain("dot git-notifications");
    expect(help.flags.map((flag) => flag.name)).toContain("since");
    expect(help.globalFlags?.map((flag) => flag.name)).toEqual(["help"]);
    expect(
      dotCommand.subcommands.flatMap((group) => group.commands).length,
    ).toBe(commandNames.length);
  });

  test("preserves unquoted multi-token notification dates", () => {
    expect(
      normalizeCliArgs([
        "git-notifications",
        "--since",
        "2",
        "days",
        "ago",
        "--bar-json",
      ]),
    ).toEqual(["git-notifications", "--since", "2 days ago", "--bar-json"]);
  });

  test("uses path primitives for path-valued options", () => {
    for (const [name, flags] of [
      ["init", ["log"]],
      ["workspace-capture", ["output", "state-dir"]],
      ["workspace-restore", ["file", "state-dir"]],
    ] as const) {
      const command = getCliCommand(name);
      if (!command) throw new Error(`${name} command missing`);
      const help = commandHelp(command, ["dot", name]);
      for (const flag of flags) {
        expect(help.flags.find((item) => item.name === flag)?.type).toBe(
          "path",
        );
      }
    }

    for (const [path, flag] of [
      [["skills", "updates-agent", "github"], "skills-dir"],
      [["skills", "updates-agent", "device"], "config"],
    ] as const) {
      const command = nestedCommand(...path);
      const help = commandHelp(command, ["dot", ...path]);
      expect(help.flags.find((item) => item.name === flag)?.type).toBe("path");
    }

    const agentOxlint = getCliCommand("agent-oxlint");
    if (!agentOxlint) throw new Error("agent-oxlint command missing");
    const agentOxlintHelp = commandHelp(agentOxlint, ["dot", "agent-oxlint"]);
    expect(agentOxlintHelp.flags.map((flag) => flag.name)).toContain("all");
    expect(agentOxlintHelp.usage).toContain("<path...>");
  });

  test("generates exact aliases, help, and choices for every shell", () => {
    for (const shell of ["bash", "fish", "zsh"] as const) {
      const completion = renderCompletions(shell);
      expect(completion).toContain("git-diff");
      expect(completion).toContain("omarchy-plugin");
      expect(completion).toContain("agent-oxlint");
      expect(completion).toContain("skills");
      expect(completion).toContain("updates-agent");
      expect(completion).toContain("--metadata-only");
      expect(completion).toContain("--reviewed-sha");
      expect(completion).toContain("--help");
      expect(completion).toContain("github");
      expect(completion).toContain("device");
      expect(completion).toContain("left");
      expect(completion).toContain("center");
      expect(completion).toContain("right");
      expect(completion).toContain("-m");
      expect(completion).toContain("-q");
      expect(completion).toContain("current");
      expect(completion).toContain("dryrun");
      expect(completion).not.toContain("---m");
      expect(completion).not.toContain("---q");
      expect(completion).not.toContain("----current");
      expect(completion).not.toContain("----dryrun");
      expect(completion).not.toContain("--no-no-");
      expect(completion).not.toContain("--no-help");
    }
  });
});
