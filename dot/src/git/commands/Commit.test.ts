import { describe, expect, test } from "bun:test";
import {
  branchProtectionError,
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

describe("branchProtectionError", () => {
  const base = {
    owner: "home-assistant",
    slug: "home-assistant/frontend",
    branch: "dev",
    myOwners: ["timmo001"],
    protectedBranches: ["dev"],
  };

  test("blocks the default branch on a repo you do not own", () => {
    const reason = branchProtectionError(base);
    expect(reason).not.toBeNull();
    expect(reason).toContain("home-assistant/frontend");
    expect(reason).toContain("dev");
  });

  test("is opt-in: no configured owners means no guard", () => {
    expect(branchProtectionError({ ...base, myOwners: [] })).toBeNull();
  });

  test("allows repos you own, even on a protected branch", () => {
    expect(
      branchProtectionError({
        ...base,
        owner: "timmo001",
        slug: "timmo001/dotfiles",
      }),
    ).toBeNull();
  });

  test("owner match is case-insensitive", () => {
    expect(
      branchProtectionError({
        ...base,
        owner: "TimMo001",
        slug: "TimMo001/dotfiles",
      }),
    ).toBeNull();
  });

  test("allows a feature branch on a repo you do not own", () => {
    expect(
      branchProtectionError({ ...base, branch: "feature/thing" }),
    ).toBeNull();
  });

  test("ignores non-GitHub or unknown remotes", () => {
    expect(
      branchProtectionError({ ...base, owner: null, slug: null }),
    ).toBeNull();
  });

  test("does not fire when the default branch cannot be resolved", () => {
    expect(
      branchProtectionError({ ...base, protectedBranches: [] }),
    ).toBeNull();
  });
});
