import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { emptyDotGitConfig } from "../services/GitConfig.js";
import type { ConfigService } from "../services/Config.js";
import { emptyMcpConfig } from "../mcp/sync/loadSpec.js";
import { ENV } from "./env.js";
import { HOME_DIR } from "./paths.js";
import {
  backupConflictingPublicTargets,
  backupUnmanagedStowTargets,
} from "./stowConflicts.js";

const previousOmarchyHost = process.env[ENV.OMARCHY_HOST];
const tempRoots: string[] = [];
const liveRoots: string[] = [];

function tempRoot(): string {
  mkdirSync(join(HOME_DIR, ".cache"), { recursive: true });
  const root = mkdtempSync(join(HOME_DIR, ".cache", "dot-stow-conflicts-"));
  tempRoots.push(root);
  return root;
}

function fakeConfig(repoBase: string): ConfigService {
  return {
    publicDotfiles: join(repoBase, "dotfiles"),
    privateDotfiles: repoBase,
    canUsePrivate: true,
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
  if (previousOmarchyHost === undefined) {
    delete process.env[ENV.OMARCHY_HOST];
  } else {
    process.env[ENV.OMARCHY_HOST] = previousOmarchyHost;
  }

  for (const root of liveRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("backupUnmanagedStowTargets", () => {
  test("backs up live files from the active host-specific package", () => {
    const root = tempRoot();
    mkdirSync(join(HOME_DIR, ".cache"), { recursive: true });
    const liveRoot = mkdtempSync(
      join(HOME_DIR, ".cache", "dot-stow-conflicts-"),
    );
    liveRoots.push(liveRoot);
    process.env[ENV.OMARCHY_HOST] = "laptop";

    const source = join(
      root,
      "chromium--laptop",
      ".cache",
      basename(liveRoot),
      "chrome-flags.conf",
    );
    const target = join(liveRoot, "chrome-flags.conf");
    mkdirSync(dirname(source), { recursive: true });
    mkdirSync(liveRoot, { recursive: true });
    writeFileSync(source, "managed\n");
    writeFileSync(target, "generated\n");

    const backedUp = backupUnmanagedStowTargets(root, fakeConfig(root));

    const backup = join(
      root,
      "backup",
      ".cache",
      basename(liveRoot),
      "chrome-flags.conf",
    );
    expect(backedUp).toEqual([{ source: target, destination: backup }]);
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(backup, "utf8")).toBe("generated\n");
  });

  test("backs up parent files that block stow target directories", () => {
    const root = tempRoot();
    const liveRoot = mkdtempSync(
      join(HOME_DIR, ".cache", "dot-stow-conflicts-"),
    );
    liveRoots.push(liveRoot);
    process.env[ENV.OMARCHY_HOST] = "laptop";

    const source = join(
      root,
      "chromium--laptop",
      ".cache",
      basename(liveRoot),
      "blocked",
      "chrome-flags.conf",
    );
    const blocker = join(liveRoot, "blocked");
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, "managed\n");
    writeFileSync(blocker, "generated parent\n");

    const backedUp = backupUnmanagedStowTargets(root, fakeConfig(root));

    const backup = join(
      root,
      "backup",
      ".cache",
      basename(liveRoot),
      "blocked",
    );
    expect(backedUp).toEqual([{ source: blocker, destination: backup }]);
    expect(existsSync(blocker)).toBe(false);
    expect(readFileSync(backup, "utf8")).toBe("generated parent\n");
  });

  test("public adopt protection leaves matching target files in place", () => {
    const root = tempRoot();
    const liveRoot = mkdtempSync(
      join(HOME_DIR, ".cache", "dot-stow-conflicts-"),
    );
    liveRoots.push(liveRoot);
    process.env[ENV.OMARCHY_HOST] = "laptop";

    const source = join(
      root,
      "chromium--laptop",
      ".cache",
      basename(liveRoot),
      "chrome-flags.conf",
    );
    const target = join(liveRoot, "chrome-flags.conf");
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, "managed\n");
    writeFileSync(target, "managed\n");

    const backedUp = backupConflictingPublicTargets(root, fakeConfig(root));

    expect(backedUp).toEqual([]);
    expect(readFileSync(target, "utf8")).toBe("managed\n");
  });

  test("does not back up targets already owned through a folded parent symlink", () => {
    const root = tempRoot();
    const liveRoot = mkdtempSync(
      join(HOME_DIR, ".cache", "dot-stow-conflicts-"),
    );
    rmSync(liveRoot, { recursive: true, force: true });
    liveRoots.push(liveRoot);
    process.env[ENV.OMARCHY_HOST] = "laptop";

    const sourceDir = join(
      root,
      "chromium--laptop",
      ".cache",
      basename(liveRoot),
    );
    const source = join(sourceDir, "chrome-flags.conf");
    const target = join(liveRoot, "chrome-flags.conf");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(source, "managed\n");
    symlinkSync(sourceDir, liveRoot);

    const backedUp = backupUnmanagedStowTargets(root, fakeConfig(root));

    expect(backedUp).toEqual([]);
    expect(readFileSync(target, "utf8")).toBe("managed\n");
  });

  test("does not follow an unmanaged parent symlink", () => {
    const root = tempRoot();
    const externalRoot = tempRoot();
    const liveRoot = join(
      HOME_DIR,
      ".cache",
      `dot-stow-link-${basename(root)}`,
    );
    liveRoots.push(liveRoot);
    process.env[ENV.OMARCHY_HOST] = "laptop";

    const source = join(
      root,
      "chromium--laptop",
      ".cache",
      basename(liveRoot),
      "chrome-flags.conf",
    );
    const externalTarget = join(externalRoot, "chrome-flags.conf");
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, "managed\n");
    writeFileSync(externalTarget, "external\n");
    symlinkSync(externalRoot, liveRoot);

    expect(backupUnmanagedStowTargets(root, fakeConfig(root))).toEqual([]);
    expect(readFileSync(externalTarget, "utf8")).toBe("external\n");
  });
});
