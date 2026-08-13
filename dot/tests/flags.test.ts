import { describe, expect, test } from "bun:test";
import { parseFlags, resolveSubcommand } from "../src/flags.js";

describe("parseFlags", () => {
  test("uses defaults without arguments", () => {
    expect(parseFlags([])).toEqual({
      subcommand: undefined,
      tab: "changed",
      repo: undefined,
      since: undefined,
      help: false,
      rest: [],
    });
  });

  test("strips the transparent tui prefix", () => {
    expect(parseFlags(["tui", "git-diff", "--tab", "other"])).toEqual({
      subcommand: "git-diff",
      tab: "unchanged",
      repo: undefined,
      since: undefined,
      help: false,
      rest: [],
    });
  });

  test("parses a git diff repository deep link", () => {
    expect(
      parseFlags(["git-diff", "--repo", "omarchy:quickshell"]),
    ).toMatchObject({
      subcommand: "git-diff",
      repo: "omarchy:quickshell",
      rest: [],
    });
  });

  test("separates command positionals from remaining arguments", () => {
    const parsed = parseFlags(["usage", "summary", "--format", "json"]);
    expect(parsed.subcommand).toBe("usage");
    expect(parsed.rest).toEqual(["summary", "--format", "json"]);
  });

  test("keeps unknown command arguments in rest", () => {
    expect(parseFlags(["unknown", "value", "--raw"])).toMatchObject({
      subcommand: "unknown",
      rest: ["value", "--raw"],
    });
  });

  test("normalizes epoch seconds and milliseconds", () => {
    expect(parseFlags(["git-notifications", "--since=1710000000"]).since).toBe(
      "2024-03-09T16:00:00.000Z",
    );
    expect(
      parseFlags(["git-notifications", "--since", "1710000000000"]).since,
    ).toBe("2024-03-09T16:00:00.000Z");
  });

  test("accepts multi-token date values", () => {
    expect(
      parseFlags(["git-notifications", "--since", "2024-03-09", "16:00:00Z"])
        .since,
    ).toBe("2024-03-09T16:00:00.000Z");
  });

  test("recognises help after a command", () => {
    expect(parseFlags(["doctor", "--help"]).help).toBe(true);
  });
});

describe("resolveSubcommand", () => {
  test("resolves native views and aliases", () => {
    expect(resolveSubcommand("dashboard")).toEqual({
      type: "view",
      viewId: "dashboard",
    });
    expect(resolveSubcommand("diff")).toEqual({
      type: "view",
      viewId: "git-diff",
    });
  });

  test("resolves menu items and rejects unknown targets", () => {
    expect(resolveSubcommand("update")).toEqual({
      type: "item",
      itemId: "update",
    });
    expect(resolveSubcommand("missing-command")).toBeUndefined();
  });
});
