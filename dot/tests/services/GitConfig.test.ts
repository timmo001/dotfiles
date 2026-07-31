import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  activeGitReposForCheck,
  activeGitReposForNotifications,
  loadDotGitConfig,
  managedGitRepoForGitHub,
  managedGitRepoForPath,
  normalizeGitHubSlug,
} from "../../src/services/GitConfig.js";

const tempRoots: string[] = [];

function writeConfig(contents: string): string {
  const root = mkdtempSync(join(tmpdir(), "dot-git-config-"));
  const filePath = join(root, "dot-git.yml");
  tempRoots.push(root);
  writeFileSync(filePath, contents);
  return filePath;
}

function validConfig(repositories: string): string {
  return `schema_version: 2
repositories:
${repositories}`;
}

function repository(overrides = ""): string {
  return `  - name: dotfiles
    path: /tmp/dotfiles
    github: git@github.com:timmo001/dotfiles.git
    activity:
      enabled: true
      schedule: "*/15 9-17 * * 1-5"
    workflows:
      enabled: false
      schedule: "* * * * *"
    notifications:
      enabled: true
      schedule: "30 14 * * 5"
      bar:
        ignore_bot_activity: true
${overrides}`;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("normalizeGitHubSlug", () => {
  test.each([
    ["owner/repo", "owner/repo"],
    ["git@github.com:owner/repo.git", "owner/repo"],
    ["ssh://git@github.com/owner/repo.git", "owner/repo"],
    ["https://github.com/owner/repo/", "owner/repo"],
    ["git://github.com/owner/repo.git", "owner/repo"],
  ])("normalises %s", (value, expected) => {
    expect(normalizeGitHubSlug(value)).toBe(expected);
  });

  test.each([
    "owner",
    "owner/repo/extra",
    "https://gitlab.com/owner/repo",
    "github.com/owner/repo",
    "owner/re po",
  ])("rejects %s", (value) => {
    expect(normalizeGitHubSlug(value)).toBeNull();
  });
});

describe("loadDotGitConfig", () => {
  test("loads and normalises a valid repository", () => {
    const filePath = writeConfig(validConfig(repository()));

    const config = loadDotGitConfig(filePath);

    expect(config).toMatchObject({
      filePath,
      present: true,
      valid: true,
      diagnostics: [],
    });
    expect(config.repositories).toEqual([
      {
        name: "dotfiles",
        path: "/tmp/dotfiles",
        github: "timmo001/dotfiles",
        postUpdate: null,
        activity: { enabled: true, schedule: "*/15 9-17 * * 1-5" },
        workflows: { enabled: false, schedule: "* * * * *" },
        notifications: {
          enabled: true,
          schedule: "30 14 * * 5",
          bar: { ignoreBotActivity: true },
        },
      },
    ]);
  });

  test("rejects unsupported keys and malformed nested values", () => {
    const filePath = writeConfig(
      validConfig(
        repository(`    unexpected: true
    workflows:
      enabled: yes
      schedule: "* * * *"
    notifications:
      enabled: true
      schedule: "* * * * *"
      bar:
        ignore_bot_activity: false
        extra: true
`),
      ),
    );

    const config = loadDotGitConfig(filePath);

    expect(config.valid).toBe(false);
    expect(config.repositories).toEqual([]);
    expect(config.diagnostics).toEqual(
      expect.arrayContaining([
        "root.repositories[0].unexpected is not supported",
        "root.repositories[0].workflows.enabled must be true or false",
        "root.repositories[0].workflows.schedule must be a five-field cron expression",
        "root.repositories[0].notifications.bar.extra is not supported",
      ]),
    );
  });

  test("loads an optional post-update command", () => {
    const config = loadDotGitConfig(
      writeConfig(validConfig(repository("    post_update: mise run build\n"))),
    );

    expect(config.valid).toBe(true);
    expect(config.repositories[0]?.postUpdate).toBe("mise run build");
  });

  test("rejects duplicate repository identifiers", () => {
    const duplicate = repository().replace("dotfiles", "other");
    const filePath = writeConfig(validConfig(`${repository()}${duplicate}`));

    const config = loadDotGitConfig(filePath);

    expect(config.valid).toBe(false);
    expect(config.repositories).toEqual([]);
    expect(config.diagnostics).toEqual(
      expect.arrayContaining([
        "Duplicate repository path: /tmp/dotfiles",
        "Duplicate repository github: timmo001/dotfiles",
      ]),
    );
  });
});

describe("managed repository selection", () => {
  test("looks repositories up by exact path and case-insensitive GitHub slug", () => {
    const config = loadDotGitConfig(writeConfig(validConfig(repository())));

    expect(managedGitRepoForPath(config, "/tmp/dotfiles")?.name).toBe(
      "dotfiles",
    );
    expect(managedGitRepoForPath(config, "/tmp/missing")).toBeUndefined();
    expect(managedGitRepoForGitHub(config, "TIMMO001/DOTFILES")?.name).toBe(
      "dotfiles",
    );
  });

  test("applies enabled flags and cron ranges to each check", () => {
    const config = loadDotGitConfig(writeConfig(validConfig(repository())));
    const scheduledTime = new Date(2026, 6, 10, 14, 30);
    const outsideSchedule = new Date(2026, 6, 11, 14, 30);

    expect(
      activeGitReposForCheck(config, "activity", scheduledTime),
    ).toHaveLength(1);
    expect(activeGitReposForCheck(config, "activity", outsideSchedule)).toEqual(
      [],
    );
    expect(activeGitReposForCheck(config, "workflows", scheduledTime)).toEqual(
      [],
    );
    expect(activeGitReposForNotifications(config, scheduledTime)).toHaveLength(
      1,
    );
    expect(activeGitReposForNotifications(config, outsideSchedule)).toEqual([]);
  });
});
