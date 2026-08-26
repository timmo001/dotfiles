import { describe, expect, test } from "bun:test";
import { lastAssistantText, opencodeBinary, resolveSession } from "./runner";

test("opencodeBinary uses the managed wrapper instead of PATH", () => {
  expect(opencodeBinary("/home/test")).toBe("/home/test/.local/bin/opencode2");
});

describe("resolveSession", () => {
  const first = {
    id: "one",
    title: "First task",
    location: { directory: "/repo" },
  };
  const second = {
    id: "two",
    title: "Second task",
    location: { directory: "/repo" },
  };

  test("uses the only active session in the pane directory", () => {
    expect(resolveSession([first], "/repo")).toEqual(first);
  });

  test("uses the Herdr terminal title to disambiguate sessions", () => {
    expect(resolveSession([first, second], "/repo", "OC | Second task…")).toEqual(
      second,
    );
  });

  test("rejects an ambiguous directory", () => {
    expect(() => resolveSession([first, second], "/repo")).toThrow(
      "Multiple active OpenCode sessions",
    );
  });
});

test("lastAssistantText returns the newest non-empty assistant text", () => {
  expect(
    lastAssistantText([
      { type: "assistant", content: [{ type: "reasoning", text: "hidden" }] },
      { type: "assistant", content: [{ type: "text", text: "Visible response" }] },
    ]),
  ).toBe("Visible response");
});
