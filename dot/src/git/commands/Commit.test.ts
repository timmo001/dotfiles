import { describe, expect, test } from "bun:test";
import {
  COMMIT_SUBJECT_MAX,
  COMMIT_SUBJECT_SOFT,
  validateCommitMessage,
} from "./Commit.js";

describe("validateCommitMessage", () => {
  test("accepts a normal single-line subject", () => {
    const result = validateCommitMessage("Add commit gateway guards");
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.subject).toBe("Add commit gateway guards");
  });

  test("trims surrounding whitespace", () => {
    const result = validateCommitMessage("  Trim me  ");
    expect(result.ok).toBe(true);
    expect(result.subject).toBe("Trim me");
  });

  test("rejects an empty message", () => {
    const result = validateCommitMessage("   ");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("empty");
  });

  test("rejects a multi-line message", () => {
    const result = validateCommitMessage("Subject line\n\nBody paragraph");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("single line");
  });

  test("rejects em-dash and en-dash", () => {
    expect(validateCommitMessage("Fix parser \u2014 tidy output").ok).toBe(
      false,
    );
    expect(validateCommitMessage("Range 1\u20135 handling").ok).toBe(false);
  });

  test("rejects tabs and control characters", () => {
    const result = validateCommitMessage("Add\ttab");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("control characters");
  });

  test("rejects a trailing full stop", () => {
    const result = validateCommitMessage("Add a thing.");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("full stop");
  });

  test("rejects subjects over the hard limit", () => {
    const result = validateCommitMessage("a ".repeat(COMMIT_SUBJECT_MAX));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain(String(COMMIT_SUBJECT_MAX));
  });

  test("warns but accepts subjects over the soft limit", () => {
    const subject = `Word ${"padding ".repeat(10)}end`.slice(
      0,
      COMMIT_SUBJECT_SOFT + 5,
    );
    const result = validateCommitMessage(subject);
    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toContain("characters");
  });

  test("warns on curly quotes, non-breaking space, and double spaces", () => {
    expect(
      validateCommitMessage("Add \u201Cquoted\u201D value").warnings.join(" "),
    ).toContain("curly quotes");
    expect(
      validateCommitMessage("Add\u00A0value").warnings.join(" "),
    ).toContain("non-breaking space");
    expect(validateCommitMessage("Add  spaced").warnings.join(" ")).toContain(
      "double space",
    );
  });

  test("warns on a bare single-word subject", () => {
    const result = validateCommitMessage("Update");
    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toContain("single word");
  });
});
