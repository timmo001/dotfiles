import { describe, expect, test } from "bun:test";
import { renderRepoShortcuts } from "../../src/lib/repoShortcuts.js";
import type { GitManagedRepo } from "../../src/services/GitConfig.js";

function repository(overrides: Partial<GitManagedRepo> = {}): GitManagedRepo {
  return {
    name: "Dotfiles",
    path: "/home/test/.config/dotfiles",
    github: "owner/dotfiles",
    aliases: ["dotfiles", "dots"],
    postUpdate: null,
    activity: { enabled: true, schedule: "* * * * *" },
    workflows: { enabled: false, schedule: "* * * * *" },
    notifications: {
      enabled: true,
      schedule: "* * * * *",
      bar: { ignoreBotActivity: true },
    },
    ...overrides,
  };
}

describe("renderRepoShortcuts", () => {
  test("renders every alias through the shared repository opener", () => {
    expect(renderRepoShortcuts([repository()])).toContain(
      "function dots() {\n  _repo_open 'Dotfiles' '/home/test/.config/dotfiles'\n}",
    );
  });

  test("quotes labels and paths for Zsh", () => {
    expect(
      renderRepoShortcuts([
        repository({ name: "Owner's Repo", path: "/tmp/owner's repo" }),
      ]),
    ).toContain("_repo_open 'Owner'\\''s Repo' '/tmp/owner'\\''s repo'");
  });
});
