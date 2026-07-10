import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ConfigService } from "../../src/services/Config.js";
import { emptyDotGitConfig } from "../../src/services/GitConfig.js";
import { emptyMcpConfig } from "../../src/mcp/sync/loadSpec.js";
import {
  listStowFolders,
  requiresNoFolding,
} from "../../src/lib/stowFolders.js";

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dot-stow-folders-"));
  tempRoots.push(root);
  return root;
}

function fakeConfig(repoBase: string): ConfigService {
  return {
    publicDotfiles: repoBase,
    privateDotfiles: repoBase,
    canUsePrivate: false,
    privateReason: "test",
    notesDir: join(repoBase, "notes"),
    omarchy: {
      repoBase,
      diffRepos: [],
      worktreeRepos: [],
      worktreeBranches: [],
      expectedBranches: {},
      enabled: false,
    },
    gitConfig: emptyDotGitConfig(join(repoBase, "dot-git.yml")),
    mcpConfig: emptyMcpConfig(join(repoBase, "mcp.yml")),
    cacheDir: join(repoBase, "cache"),
    stateDir: join(repoBase, "state"),
    logDir: join(repoBase, "state", "logs"),
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("listStowFolders", () => {
  test("excludes repository-only and inactive host directories", () => {
    const root = tempRoot();
    for (const folder of [
      "scripts",
      "dot",
      "dot-migration",
      "docs",
      "tests",
      "backup",
      ".github",
      "scripts--desktop",
      "scripts--laptop",
    ]) {
      mkdirSync(join(root, folder));
    }
    writeFileSync(join(root, "README.md"), "not a directory");

    expect(listStowFolders(root, fakeConfig(root))).toEqual([
      "scripts--desktop",
      "scripts",
    ]);
  });
});

describe("requiresNoFolding", () => {
  test("detects packages targeting shared runtime directories", () => {
    const root = tempRoot();
    mkdirSync(join(root, "scripts", ".local", "bin"), { recursive: true });
    mkdirSync(join(root, "plain", ".config", "example"), { recursive: true });

    expect(requiresNoFolding(root, "scripts")).toBe(true);
    expect(requiresNoFolding(root, "plain")).toBe(false);
  });
});
