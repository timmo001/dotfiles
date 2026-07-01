import { describe, expect, test } from "bun:test";
import {
  branchProtectionError,
  COMMIT_SUBJECT_MAX,
  COMMIT_SUBJECT_SOFT,
  foreignRemoteSlug,
  parseRemotes,
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

describe("parseRemotes", () => {
  test("collapses fetch/push lines into one ref per remote", () => {
    const output = [
      "origin\tgit@github.com:timmo001/frontend.git (fetch)",
      "origin\tgit@github.com:timmo001/frontend.git (push)",
      "upstream\thttps://github.com/home-assistant/frontend.git (fetch)",
      "upstream\thttps://github.com/home-assistant/frontend.git (push)",
    ].join("\n");
    expect(parseRemotes(output)).toEqual([
      { name: "origin", slug: "timmo001/frontend" },
      { name: "upstream", slug: "home-assistant/frontend" },
    ]);
  });

  test("keeps a null slug for non-GitHub remotes", () => {
    expect(parseRemotes("origin\tgit@gitlab.com:me/x.git (fetch)")).toEqual([
      { name: "origin", slug: null },
    ]);
  });
});

describe("foreignRemoteSlug", () => {
  const owners = ["timmo001"];

  test("flags a direct clone of someone else's repo (foreign origin)", () => {
    expect(
      foreignRemoteSlug(
        [{ name: "origin", slug: "home-assistant/frontend" }],
        owners,
      ),
    ).toBe("home-assistant/frontend");
  });

  test("flags a fork kept for upstream PRs (foreign upstream)", () => {
    expect(
      foreignRemoteSlug(
        [
          { name: "origin", slug: "timmo001/frontend" },
          { name: "upstream", slug: "home-assistant/frontend" },
        ],
        owners,
      ),
    ).toBe("home-assistant/frontend");
  });

  test("allows your own repo", () => {
    expect(
      foreignRemoteSlug(
        [{ name: "origin", slug: "timmo001/dotfiles" }],
        owners,
      ),
    ).toBeNull();
  });

  test("allows a takeover fork with no foreign remote", () => {
    expect(
      foreignRemoteSlug(
        [{ name: "origin", slug: "timmo001/frontend" }],
        owners,
      ),
    ).toBeNull();
  });

  test("is opt-in: no configured owners means no guard", () => {
    expect(
      foreignRemoteSlug(
        [{ name: "origin", slug: "home-assistant/frontend" }],
        [],
      ),
    ).toBeNull();
  });

  test("owner match is case-insensitive", () => {
    expect(
      foreignRemoteSlug(
        [{ name: "origin", slug: "TimMo001/dotfiles" }],
        owners,
      ),
    ).toBeNull();
  });
});

describe("branchProtectionError", () => {
  const base = {
    foreignSlug: "home-assistant/frontend",
    branch: "dev",
    baseBranch: "dev",
  };

  test("blocks the base branch of a repo you do not own", () => {
    const reason = branchProtectionError(base);
    expect(reason).not.toBeNull();
    expect(reason).toContain("home-assistant/frontend");
    expect(reason).toContain("dev");
  });

  test("allows your own repo (no foreign slug), even on its base branch", () => {
    expect(branchProtectionError({ ...base, foreignSlug: null })).toBeNull();
  });

  test("allows a feature branch on a repo you do not own", () => {
    expect(
      branchProtectionError({ ...base, branch: "feature/thing" }),
    ).toBeNull();
  });

  test("base-branch match is case-insensitive", () => {
    expect(
      branchProtectionError({ ...base, branch: "Dev", baseBranch: "dev" }),
    ).not.toBeNull();
  });

  test("does not fire when the base branch cannot be resolved", () => {
    expect(branchProtectionError({ ...base, baseBranch: null })).toBeNull();
  });
});
