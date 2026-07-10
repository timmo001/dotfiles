import { describe, expect, test } from "bun:test";
import { renderHelp } from "../../src/cli/help.js";
import {
  cliCommands,
  getCliCommand,
  nativeCommandNames,
} from "../../src/cli/spec.js";

describe("CLI command registry", () => {
  test("has unique command names and aliases", () => {
    const names = cliCommands.flatMap((command) => [
      command.name,
      ...(command.aliases ?? []),
    ]);
    expect(new Set(names).size).toBe(names.length);
    expect(nativeCommandNames).toEqual(new Set(names));
  });

  test("resolves canonical names and aliases", () => {
    expect(getCliCommand("update")?.name).toBe("update");
    expect(getCliCommand("up")?.name).toBe("update");
    expect(getCliCommand("missing-command")).toBeUndefined();
  });
});

describe("renderHelp", () => {
  test("lists every canonical command in root help", () => {
    const help = renderHelp();
    expect(help).toStartWith("Usage: dot [subcommand] [options]");
    for (const command of cliCommands) expect(help).toContain(command.name);
  });

  test("renders command options and examples", () => {
    const help = renderHelp("git-workflows");
    expect(help).toContain("Usage: dot git-workflows");
    expect(help).toContain("--bar-json");
    expect(help).toContain("--since <date>");
    expect(help).toContain("Examples:");
  });

  test("falls back to help for unknown commands", () => {
    expect(renderHelp("missing-command")).toBe(renderHelp("help"));
  });
});
