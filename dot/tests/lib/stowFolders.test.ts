import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ConfigService } from "../../src/services/Config.js";
import { emptyDotGitConfig } from "../../src/services/GitConfig.js";
import { emptyMcpConfig } from "../../src/mcp/sync/loadSpec.js";
import { ENV } from "../../src/lib/env.js";
import {
  listStowFolders,
  requiresNoFolding,
} from "../../src/lib/stowFolders.js";

const tempRoots: string[] = [];
const previousOmarchyHost = process.env[ENV.OMARCHY_HOST];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dot-stow-folders-"));
  tempRoots.push(root);
  return root;
}

function fakeConfig(repoBase: string): ConfigService {
  const omarchyRepoBase = join(repoBase, ".omarchy");
  const desktopHost = join(omarchyRepoBase, "hypr", "hosts", "desktop");
  mkdirSync(desktopHost, { recursive: true });
  symlinkSync(desktopHost, join(omarchyRepoBase, "hypr", "host"), "dir");

  return {
    publicDotfiles: repoBase,
    privateDotfiles: repoBase,
    canUsePrivate: false,
    privateReason: "test",
    notesDir: join(repoBase, "notes"),
    omarchy: {
      repoBase: omarchyRepoBase,
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
  if (previousOmarchyHost === undefined) {
    delete process.env[ENV.OMARCHY_HOST];
  } else {
    process.env[ENV.OMARCHY_HOST] = previousOmarchyHost;
  }

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("listStowFolders", () => {
  test("excludes repository-only and inactive host directories", () => {
    delete process.env[ENV.OMARCHY_HOST];
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

    expect(listStowFolders(root, fakeConfig(root)).sort()).toEqual([
      "scripts",
      "scripts--desktop",
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
