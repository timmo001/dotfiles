import { describe, expect, test } from "bun:test";
import { formatCommandError, pipeRow } from "../../../src/git/commands/rows.js";

describe("pipeRow", () => {
  test("sanitizes delimiters and line breaks", () => {
    expect(pipeRow([" first|value ", "second\r\nline", null, undefined])).toBe(
      "first value|second line||",
    );
  });
});

describe("formatCommandError", () => {
  test("prefers Error and object messages", () => {
    expect(formatCommandError(new Error("failed"))).toBe("failed");
    expect(formatCommandError({ message: "broken" })).toBe("broken");
  });

  test("falls back to string conversion", () => {
    expect(formatCommandError(42)).toBe("42");
    expect(formatCommandError({ message: "" })).toBe("[object Object]");
  });
});
