import { describe, expect, test } from "bun:test";
import { parseFlags } from "../src/flags.js";

describe("parseFlags", () => {
  test("uses defaults without arguments", () => {
    expect(parseFlags([])).toEqual({
      subcommand: undefined,
      since: undefined,
      help: false,
      rest: [],
    });
  });

  test("treats the removed tui command as unknown", () => {
    expect(parseFlags(["tui", "git-notifications"])).toEqual({
      subcommand: "tui",
      since: undefined,
      help: false,
      rest: ["git-notifications"],
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
