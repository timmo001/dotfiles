import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ConfigService } from "../../src/services/Config.js";
import { ENV } from "../../src/lib/env.js";
import { emptyDotGitConfig } from "../../src/services/GitConfig.js";
import { emptyMcpConfig } from "../../src/mcp/sync/loadSpec.js";
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

function fakeConfig(repoBase: string, host = "desktop"): ConfigService {
  const omarchyRepoBase = join(repoBase, ".omarchy");
  const hostDir = join(omarchyRepoBase, "hypr", "hosts", host);
  mkdirSync(hostDir, { recursive: true });
  symlinkSync(hostDir, join(omarchyRepoBase, "hypr", "host"), "dir");

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

  test("selects the requested host-specific package", () => {
    process.env[ENV.OMARCHY_HOST] = "laptop";
    const root = tempRoot();
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "scripts--desktop"));
    mkdirSync(join(root, "scripts--laptop"));

    expect(listStowFolders(root, fakeConfig(root)).sort()).toEqual([
      "scripts",
      "scripts--laptop",
    ]);
  });

  test("falls back to the persisted Hypr host link", () => {
    delete process.env[ENV.OMARCHY_HOST];
    const root = tempRoot();
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "scripts--desktop"));
    mkdirSync(join(root, "scripts--laptop"));

    expect(listStowFolders(root, fakeConfig(root, "laptop")).sort()).toEqual([
      "scripts",
      "scripts--laptop",
    ]);
  });

  test("prefers the environment host over the persisted Hypr host link", () => {
    process.env[ENV.OMARCHY_HOST] = "desktop";
    const root = tempRoot();
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "scripts--desktop"));
    mkdirSync(join(root, "scripts--laptop"));

    expect(listStowFolders(root, fakeConfig(root, "laptop")).sort()).toEqual([
      "scripts",
      "scripts--desktop",
    ]);
  });
});

describe("requiresNoFolding", () => {
  test("detects packages targeting shared runtime directories", () => {
    const root = tempRoot();
    mkdirSync(join(root, "scripts", ".local", "bin"), { recursive: true });
    mkdirSync(join(root, "herdr", ".config", "herdr"), { recursive: true });
    mkdirSync(join(root, "uwsm", ".config", "uwsm"), { recursive: true });
    mkdirSync(join(root, "plain", ".config", "example"), { recursive: true });

    expect(requiresNoFolding(root, "scripts")).toBe(true);
    expect(requiresNoFolding(root, "herdr")).toBe(true);
    expect(requiresNoFolding(root, "uwsm")).toBe(true);
    expect(requiresNoFolding(root, "plain")).toBe(false);
  });
});
