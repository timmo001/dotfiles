import { describe, expect, test } from "bun:test";
import {
  branchProtectionError,
  parseRemotes,
  type BaseBranchGuardInput,
} from "../../dot/src/git/commands/Commit";

const fork: BaseBranchGuardInput = {
  remotes: [
    { name: "origin", slug: "maintainer/sdk" },
    { name: "upstream", slug: "upstream/sdk" },
  ],
  myOwners: ["maintainer"],
  branch: "fork/main",
  baseBranch: "fork/main",
  maintainedForkBranch: null,
};

describe("maintained-fork commit guard", () => {
  test("keeps contribution forks protected without an explicit opt-in", () => {
    expect(branchProtectionError(fork)).toContain("Refusing to commit");
  });

  test("allows the exact configured maintenance branch with an owned origin", () => {
    expect(
      branchProtectionError({ ...fork, maintainedForkBranch: "fork/main" }),
    ).toBeNull();
  });

  test.each(["main", "fork/*", "Fork/main"])(
    "does not widen the exception from %s to another branch",
    (maintainedForkBranch) => {
      expect(
        branchProtectionError({ ...fork, maintainedForkBranch }),
      ).toContain("Refusing to commit");
    },
  );

  test.each([null, "upstream/sdk"])(
    "rejects an unknown or foreign origin even with the opt-in: %s",
    (slug) => {
      expect(
        branchProtectionError({
          ...fork,
          maintainedForkBranch: "fork/main",
          remotes: [
            { name: "origin", slug },
            { name: "upstream", slug: "upstream/sdk" },
          ],
        }),
      ).toContain("Refusing to commit");
    },
  );

  test("rejects a missing origin", () => {
    expect(
      branchProtectionError({
        ...fork,
        maintainedForkBranch: "fork/main",
        remotes: [{ name: "upstream", slug: "upstream/sdk" }],
      }),
    ).toContain("Refusing to commit");
  });

  test("does not treat an owned fetch target as ownership of a foreign push target", () => {
    const remotes = parseRemotes(
      [
        "origin\tgit@github.com:maintainer/sdk.git (fetch)",
        "origin\tgit@github.com:upstream/sdk.git (push)",
        "upstream\thttps://github.com/upstream/sdk.git (fetch)",
        "upstream\thttps://github.com/upstream/sdk.git (push)",
      ].join("\n"),
    );

    expect(
      branchProtectionError({
        ...fork,
        remotes,
        maintainedForkBranch: "fork/main",
      }),
    ).toContain("Refusing to commit");
  });

  test("still permits feature branches", () => {
    expect(
      branchProtectionError({ ...fork, branch: "fix/maintenance" }),
    ).toBeNull();
  });
});
