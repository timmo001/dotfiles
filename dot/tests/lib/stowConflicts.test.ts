import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { emptyDotGitConfig } from "../../src/services/GitConfig.js";
import type { ConfigService } from "../../src/services/Config.js";
import { emptyMcpConfig } from "../../src/mcp/sync/loadSpec.js";
import { ENV } from "../../src/lib/env.js";
import { HOME_DIR } from "../../src/lib/paths.js";
import {
  backupConflictingPublicTargets,
  backupUnmanagedStowTargets,
  removeStowedSkillOwner,
  removeStaleSkillSymlinks,
  removeRetiredPrivateCrashHook,
  removeRetiredPublicStowLinks,
  removeLegacyUwsmRepo,
} from "../../src/lib/stowConflicts.js";

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

describe("removeLegacyUwsmRepo", () => {
  test("removes the retired fork including generated migration files", () => {
    const root = tempRoot();
    const source = join(root, "uwsm");
    mkdirSync(join(source, ".git"), { recursive: true });
    mkdirSync(join(source, "env.d"), { recursive: true });
    writeFileSync(
      join(source, ".git", "config"),
      "url = git@github.com:timmo001/omarchy-uwsm.git\n",
    );
    writeFileSync(
      join(source, "env.d", "99-omarchy-upgrade-env"),
      "generated\n",
    );
    writeFileSync(
      join(source, "env.omarchy-upgrade-to-quattro.20260812115936.bak"),
      "generated\n",
    );

    expect(removeLegacyUwsmRepo(source)).toBe(source);
    expect(existsSync(source)).toBe(false);
  });

  test("leaves unrelated repositories untouched", () => {
    const root = tempRoot();
    const source = join(root, "uwsm");
    mkdirSync(join(source, ".git"), { recursive: true });
    writeFileSync(
      join(source, ".git", "config"),
      "url = git@github.com:someone/uwsm.git\n",
    );

    expect(removeLegacyUwsmRepo(source)).toBeNull();
    expect(existsSync(source)).toBe(true);
  });
});

describe("removeRetiredPublicStowLinks", () => {
  test("removes only retired links owned by the public stow source", () => {
    const root = tempRoot();
    const publicDotfiles = join(root, "dotfiles");
    const homeDir = join(root, "home");
    const retiredSource = join(publicDotfiles, "scripts/.local/bin/waybar");
    const retiredTarget = join(homeDir, ".local/bin/waybar");
    const retiredPluginSource = join(
      publicDotfiles,
      "omarchy/.config/omarchy/plugins/omaconnect",
    );
    const retiredPluginTarget = join(
      homeDir,
      ".config/omarchy/plugins/omaconnect",
    );
    const unrelatedTarget = join(homeDir, ".local/bin/external-helper");
    mkdirSync(dirname(retiredSource), { recursive: true });
    mkdirSync(dirname(retiredTarget), { recursive: true });
    mkdirSync(dirname(retiredPluginTarget), { recursive: true });
    symlinkSync(retiredSource, retiredTarget);
    symlinkSync(retiredPluginSource, retiredPluginTarget);
    symlinkSync("/tmp/external-helper", unrelatedTarget);

    expect(removeRetiredPublicStowLinks(publicDotfiles, homeDir)).toEqual([
      retiredTarget,
      retiredPluginTarget,
    ]);
    expect(existsSync(retiredTarget)).toBe(false);
    expect(existsSync(retiredPluginTarget)).toBe(false);
    expect(existsSync(unrelatedTarget)).toBe(false);
    expect(() => lstatSync(unrelatedTarget)).not.toThrow();
  });
});

describe("removeRetiredPrivateCrashHook", () => {
  test("removes only the private-owned crash hook link", () => {
    const root = tempRoot();
    const privateDotfiles = join(root, "dotfiles-private");
    const homeDir = join(root, "home");
    const source = join(
      privateDotfiles,
      "omarchy-hooks/.config/omarchy/hooks/agent-crash",
    );
    const target = join(homeDir, ".config/omarchy/hooks/agent-crash");
    mkdirSync(dirname(source), { recursive: true });
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(source, "hook\n");
    symlinkSync(source, target);

    expect(removeRetiredPrivateCrashHook(privateDotfiles, homeDir)).toBe(
      target,
    );
    expect(existsSync(target)).toBe(false);

    symlinkSync("/tmp/unrelated-agent-crash", target);
    expect(removeRetiredPrivateCrashHook(privateDotfiles, homeDir)).toBeNull();
    expect(() => lstatSync(target)).not.toThrow();
  });
});

describe("backupUnmanagedStowTargets", () => {
  test("leaves explicitly ignored targets in place", () => {
    const root = tempRoot();
    const liveRoot = mkdtempSync(
      join(HOME_DIR, ".cache", "dot-stow-conflicts-"),
    );
    liveRoots.push(liveRoot);
    const relativeTarget = join(".cache", basename(liveRoot), "installed.md");
    const source = join(root, "agents", relativeTarget);
    const target = join(HOME_DIR, relativeTarget);
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, "stowed\n");
    writeFileSync(target, "external\n");

    expect(
      backupUnmanagedStowTargets(
        root,
        fakeConfig(root),
        new Set([dirname(relativeTarget)]),
      ),
    ).toEqual([]);
    expect(readFileSync(target, "utf8")).toBe("external\n");
  });

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

describe("removeStaleSkillSymlinks", () => {
  test("removes broken links owned by the stow repo and their empty skill directory", () => {
    const root = tempRoot();
    const skillsDir = join(root, "live-skills");
    const skillDir = join(skillsDir, "removed-skill");
    const staleTarget = join(
      root,
      "dotfiles",
      "agents",
      "removed-skill",
      "SKILL.md",
    );
    mkdirSync(skillDir, { recursive: true });
    symlinkSync(staleTarget, join(skillDir, "SKILL.md"));

    expect(
      removeStaleSkillSymlinks(join(root, "dotfiles"), [skillsDir]),
    ).toEqual([join(skillDir, "SKILL.md")]);
    expect(existsSync(skillDir)).toBe(false);
  });

  test("preserves broken external skill links", () => {
    const root = tempRoot();
    const skillsDir = join(root, "live-skills");
    const skillDir = join(skillsDir, "external-skill");
    const link = join(skillDir, "SKILL.md");
    mkdirSync(skillDir, { recursive: true });
    symlinkSync(join(root, "external", "SKILL.md"), link);

    expect(
      removeStaleSkillSymlinks(join(root, "dotfiles"), [skillsDir]),
    ).toEqual([]);
    expect(existsSync(skillDir)).toBe(true);
  });
});
