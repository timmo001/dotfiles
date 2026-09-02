import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderRepoShortcuts,
  writeRepoPicker,
} from "../../src/lib/repoShortcuts.js";
import type { GitManagedRepo } from "../../src/services/GitConfig.js";

function repository(overrides: Partial<GitManagedRepo> = {}): GitManagedRepo {
  return {
    name: "Dotfiles",
    path: "/home/test/.config/dotfiles",
    github: "owner/dotfiles",
    aliases: ["dotfiles", "dots"],
    postUpdate: null,
    agentOxlint: false,
    activity: { enabled: true, schedule: "* * * * *" },
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

  test("writes picker entries with configured names and paths", () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "repo-picker-"));
    const target = writeRepoPicker(cacheDir, [repository()]);

    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual([
      { name: "Dotfiles", path: "/home/test/.config/dotfiles" },
    ]);
  });
});
