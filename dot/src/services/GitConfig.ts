import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { displayPath, expandHomePath } from "../lib/paths.js";

const TOP_LEVEL_KEYS = new Set(["schema_version", "repositories", "shortcuts"]);
const REPO_KEYS = new Set([
  "name",
  "path",
  "github",
  "aliases",
  "post_update",
  "activity",
  "notifications",
]);
const CHECK_KEYS = new Set(["enabled", "schedule"]);
const NOTIFICATION_KEYS = new Set(["enabled", "schedule", "bar"]);
const NOTIFICATION_BAR_KEYS = new Set(["ignore_bot_activity"]);
const SHORTCUT_KEYS = new Set(["name", "path", "aliases"]);

/** A shell shortcut target generated from private git configuration. */
export interface GitRepoShortcut {
  /** Friendly Herdr workspace label. */
  readonly name: string;
  /** Absolute filesystem path. */
  readonly path: string;
  /** Generated shell function names. */
  readonly aliases: readonly string[];
}

/** Git checks that can be independently toggled and scheduled. */
export type GitRepoCheckName = "activity";

/** Explicit per-check config for a managed git repository. */
export interface GitRepoCheckConfig {
  /** Whether this check is enabled for the repository. */
  readonly enabled: boolean;
  /** Five-field cron schedule in local time. */
  readonly schedule: string;
}

/** Status-bar output filters for a managed repository. */
export interface GitRepoNotificationBarConfig {
  /** Hide bot-only activity from bar JSON outputs for this repository. */
  readonly ignoreBotActivity: boolean;
}

/** GitHub notification check config for a managed repository. */
export interface GitRepoNotificationConfig extends GitRepoCheckConfig {
  /** Status-bar output filters. */
  readonly bar: GitRepoNotificationBarConfig;
}

/** A repository managed by the private dot git config. */
export interface GitManagedRepo {
  /** Short display name. */
  readonly name: string;
  /** Absolute filesystem path. */
  readonly path: string;
  /** Normalised GitHub owner/repo slug. */
  readonly github: string;
  /** Shell shortcuts generated for this repository. */
  readonly aliases: readonly string[];
  /** Command run from the repository root after `dot update` pulls a new HEAD. */
  readonly postUpdate: string | null;
  /** Local activity check used by git diff and git log. */
  readonly activity: GitRepoCheckConfig;
  /** GitHub notification check and status-bar filters. */
  readonly notifications: GitRepoNotificationConfig;
}

/** Loaded private dot git config and validation diagnostics. */
export interface DotGitConfig {
  /** Path the config was loaded from. */
  readonly filePath: string;
  /** Whether the YAML file exists. */
  readonly present: boolean;
  /** Whether the YAML file parsed and validated cleanly. */
  readonly valid: boolean;
  /** Normalised managed repositories. Empty when invalid. */
  readonly repositories: readonly GitManagedRepo[];
  /** Additional shell shortcut targets that are not managed repositories. */
  readonly shortcuts: readonly GitRepoShortcut[];
  /** Validation diagnostics for missing or malformed config. */
  readonly diagnostics: readonly string[];
}

interface ParsedGitConfig {
  readonly repositories: readonly GitManagedRepo[];
  readonly shortcuts: readonly GitRepoShortcut[];
  readonly diagnostics: readonly string[];
}

/** Return the default private git config path for a private dotfiles repo. */
export function defaultDotGitConfigPath(privateDotfiles: string): string {
  return join(privateDotfiles, "dot-git.yml");
}

/** Return an empty git config with the supplied availability diagnostics. */
export function emptyDotGitConfig(
  filePath: string,
  diagnostics: readonly string[] = [],
): DotGitConfig {
  return {
    filePath,
    present: false,
    valid: diagnostics.length === 0,
    repositories: [],
    shortcuts: [],
    diagnostics,
  };
}

/** Load and strictly validate the private dot git YAML config. */
export function loadDotGitConfig(filePath: string): DotGitConfig {
  if (!existsSync(filePath)) {
    return emptyDotGitConfig(filePath, [
      `Missing private git config: ${displayPath(filePath)}`,
    ]);
  }

  try {
    const parsed = Bun.YAML.parse(readFileSync(filePath, "utf-8")) as unknown;
    const result = parseDotGitConfig(parsed);
    return {
      filePath,
      present: true,
      valid: result.diagnostics.length === 0,
      repositories: result.diagnostics.length === 0 ? result.repositories : [],
      shortcuts: result.diagnostics.length === 0 ? result.shortcuts : [],
      diagnostics: result.diagnostics,
    };
  } catch (error) {
    return {
      filePath,
      present: true,
      valid: false,
      repositories: [],
      shortcuts: [],
      diagnostics: [
        `Could not read private git config ${displayPath(filePath)}: ${formatError(error)}`,
      ],
    };
  }
}

/** Return every managed repository when the config is valid. */
export function managedGitRepos(
  gitConfig: DotGitConfig,
): readonly GitManagedRepo[] {
  return gitConfig.valid ? gitConfig.repositories : [];
}

/** Return repositories with an enabled check whose schedule is currently active. */
export function activeGitReposForCheck(
  gitConfig: DotGitConfig,
  check: GitRepoCheckName,
  now: Date = new Date(),
): readonly GitManagedRepo[] {
  return managedGitRepos(gitConfig).filter((repo) =>
    gitRepoCheckActive(repo, check, now),
  );
}

/** Return repositories with enabled GitHub notifications whose schedule is active. */
export function activeGitReposForNotifications(
  gitConfig: DotGitConfig,
  now: Date = new Date(),
): readonly GitManagedRepo[] {
  return managedGitRepos(gitConfig).filter((repo) =>
    gitRepoNotificationsActive(repo, now),
  );
}

/** Return the managed repository for an absolute path, when present. */
export function managedGitRepoForPath(
  gitConfig: DotGitConfig,
  path: string,
): GitManagedRepo | undefined {
  return managedGitRepos(gitConfig).find((repo) => repo.path === path);
}

/** Return the managed repository for a GitHub owner/repo slug, when present. */
export function managedGitRepoForGitHub(
  gitConfig: DotGitConfig,
  github: string,
): GitManagedRepo | undefined {
  const normalized = github.toLowerCase();
  return managedGitRepos(gitConfig).find(
    (repo) => repo.github.toLowerCase() === normalized,
  );
}

/** Check whether a repository check is enabled and currently in schedule. */
export function gitRepoCheckActive(
  repo: GitManagedRepo,
  check: GitRepoCheckName,
  now: Date = new Date(),
): boolean {
  const config = repo[check];
  return config.enabled && cronScheduleActive(config.schedule, now);
}

/** Check whether a repository notification check is enabled and currently in schedule. */
export function gitRepoNotificationsActive(
  repo: GitManagedRepo,
  now: Date = new Date(),
): boolean {
  return (
    repo.notifications.enabled &&
    cronScheduleActive(repo.notifications.schedule, now)
  );
}

function parseDotGitConfig(value: unknown): ParsedGitConfig {
  const diagnostics: string[] = [];
  if (!isRecord(value)) {
    return {
      repositories: [],
      shortcuts: [],
      diagnostics: ["dot-git.yml must contain a YAML object"],
    };
  }

  pushUnknownKeyDiagnostics(diagnostics, value, TOP_LEVEL_KEYS, "root");
  if (value.schema_version !== 2) {
    diagnostics.push("root.schema_version must be 2");
  }
  if (!Array.isArray(value.repositories)) {
    diagnostics.push("root.repositories must be an array");
    return { repositories: [], shortcuts: [], diagnostics };
  }

  const repositories = value.repositories.flatMap((repo, index) =>
    parseRepo(repo, index, diagnostics),
  );
  const shortcuts = parseShortcuts(value.shortcuts, diagnostics);
  pushDuplicateDiagnostics(diagnostics, repositories, "name");
  pushDuplicateDiagnostics(diagnostics, repositories, "path");
  pushDuplicateDiagnostics(diagnostics, repositories, "github");
  pushDuplicateAliasDiagnostics(diagnostics, [...repositories, ...shortcuts]);

  return { repositories, shortcuts, diagnostics };
}

function parseShortcuts(
  value: unknown,
  diagnostics: string[],
): readonly GitRepoShortcut[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push("root.shortcuts must be an array");
    return [];
  }

  return value.flatMap((shortcut, index) => {
    const location = `root.shortcuts[${index}]`;
    if (!isRecord(shortcut)) {
      diagnostics.push(`${location} must be an object`);
      return [];
    }
    pushUnknownKeyDiagnostics(diagnostics, shortcut, SHORTCUT_KEYS, location);
    const name = requiredString(shortcut.name, `${location}.name`, diagnostics);
    const path = requiredString(shortcut.path, `${location}.path`, diagnostics);
    const aliases = optionalAliases(
      shortcut.aliases,
      `${location}.aliases`,
      diagnostics,
    );
    return name && path ? [{ name, path: expandHomePath(path), aliases }] : [];
  });
}

function parseRepo(
  value: unknown,
  index: number,
  diagnostics: string[],
): readonly GitManagedRepo[] {
  const location = `root.repositories[${index}]`;
  if (!isRecord(value)) {
    diagnostics.push(`${location} must be an object`);
    return [];
  }

  pushUnknownKeyDiagnostics(diagnostics, value, REPO_KEYS, location);
  const name = requiredString(value.name, `${location}.name`, diagnostics);
  const rawPath = requiredString(value.path, `${location}.path`, diagnostics);
  const rawGithub = requiredString(
    value.github,
    `${location}.github`,
    diagnostics,
  );
  const postUpdate = optionalString(
    value.post_update,
    `${location}.post_update`,
    diagnostics,
  );
  const aliases = optionalAliases(
    value.aliases,
    `${location}.aliases`,
    diagnostics,
  );
  const activity = parseCheck(
    value.activity,
    `${location}.activity`,
    diagnostics,
  );
  const notifications = parseNotifications(
    value.notifications,
    `${location}.notifications`,
    diagnostics,
  );
  const github = rawGithub ? normalizeGitHubSlug(rawGithub) : null;
  if (rawGithub && !github) {
    diagnostics.push(`${location}.github must be a GitHub owner/repo slug`);
  }

  if (!name || !rawPath || !github || !activity || !notifications) return [];
  return [
    {
      name,
      path: expandHomePath(rawPath),
      github,
      aliases,
      postUpdate,
      activity,
      notifications,
    },
  ];
}

function optionalAliases(
  value: unknown,
  location: string,
  diagnostics: string[],
): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(`${location} must be an array`);
    return [];
  }

  return value.flatMap((alias, index) => {
    if (typeof alias !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(alias)) {
      diagnostics.push(`${location}[${index}] must be a valid shell alias`);
      return [];
    }
    return [alias];
  });
}

function optionalString(
  value: unknown,
  location: string,
  diagnostics: string[],
): string | null {
  if (value === undefined) return null;
  return requiredString(value, location, diagnostics);
}

function parseNotifications(
  value: unknown,
  location: string,
  diagnostics: string[],
): GitRepoNotificationConfig | null {
  if (!isRecord(value)) {
    diagnostics.push(`${location} must be an object`);
    return null;
  }

  pushUnknownKeyDiagnostics(diagnostics, value, NOTIFICATION_KEYS, location);
  const enabled = requiredBoolean(
    value.enabled,
    `${location}.enabled`,
    diagnostics,
  );
  const schedule = requiredString(
    value.schedule,
    `${location}.schedule`,
    diagnostics,
  );
  if (schedule && !validCronSchedule(schedule)) {
    diagnostics.push(
      `${location}.schedule must be a five-field cron expression`,
    );
  }
  const bar = parseNotificationBar(value.bar, `${location}.bar`, diagnostics);

  return enabled === null || !schedule || !bar
    ? null
    : { enabled, schedule, bar };
}

function parseNotificationBar(
  value: unknown,
  location: string,
  diagnostics: string[],
): GitRepoNotificationBarConfig | null {
  if (!isRecord(value)) {
    diagnostics.push(`${location} must be an object`);
    return null;
  }

  pushUnknownKeyDiagnostics(
    diagnostics,
    value,
    NOTIFICATION_BAR_KEYS,
    location,
  );
  const ignoreBotActivity = requiredBoolean(
    value.ignore_bot_activity,
    `${location}.ignore_bot_activity`,
    diagnostics,
  );

  return ignoreBotActivity === null ? null : { ignoreBotActivity };
}

function parseCheck(
  value: unknown,
  location: string,
  diagnostics: string[],
): GitRepoCheckConfig | null {
  if (!isRecord(value)) {
    diagnostics.push(`${location} must be an object`);
    return null;
  }

  pushUnknownKeyDiagnostics(diagnostics, value, CHECK_KEYS, location);
  const enabled = requiredBoolean(
    value.enabled,
    `${location}.enabled`,
    diagnostics,
  );
  const schedule = requiredString(
    value.schedule,
    `${location}.schedule`,
    diagnostics,
  );
  if (schedule && !validCronSchedule(schedule)) {
    diagnostics.push(
      `${location}.schedule must be a five-field cron expression`,
    );
  }

  return enabled === null || !schedule ? null : { enabled, schedule };
}

function requiredString(
  value: unknown,
  location: string,
  diagnostics: string[],
): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push(`${location} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function requiredBoolean(
  value: unknown,
  location: string,
  diagnostics: string[],
): boolean | null {
  if (typeof value !== "boolean") {
    diagnostics.push(`${location} must be true or false`);
    return null;
  }
  return value;
}

function pushUnknownKeyDiagnostics(
  diagnostics: string[],
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key))
      diagnostics.push(`${location}.${key} is not supported`);
  }
}

function pushDuplicateDiagnostics(
  diagnostics: string[],
  repositories: readonly GitManagedRepo[],
  key: "name" | "path" | "github",
): void {
  const seen = new Set<string>();
  for (const repo of repositories) {
    const value = repo[key];
    if (seen.has(value))
      diagnostics.push(`Duplicate repository ${key}: ${value}`);
    seen.add(value);
  }
}

function pushDuplicateAliasDiagnostics(
  diagnostics: string[],
  repositories: readonly GitRepoShortcut[],
): void {
  const seen = new Set<string>();
  for (const repo of repositories) {
    for (const alias of repo.aliases) {
      if (seen.has(alias))
        diagnostics.push(`Duplicate repository alias: ${alias}`);
      seen.add(alias);
    }
  }
}

function validCronSchedule(schedule: string): boolean {
  return schedule.trim().split(/\s+/).length === 5;
}

function cronScheduleActive(schedule: string, now: Date): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const checks: readonly [
    value: number,
    expr: string,
    min: number,
    max: number,
  ][] = [
    [now.getMinutes(), fields[0], 0, 59],
    [now.getHours(), fields[1], 0, 23],
    [now.getDate(), fields[2], 1, 31],
    [now.getMonth() + 1, fields[3], 1, 12],
    [now.getDay(), fields[4], 0, 6],
  ];
  return checks.every(([value, expr, min, max]) =>
    cronFieldMatches(value, expr, min, max),
  );
}

function cronFieldMatches(
  value: number,
  expr: string,
  min: number,
  max: number,
): boolean {
  const trimmed = expr.trim();
  if (trimmed === "*" || trimmed === "?") return true;
  return trimmed
    .split(",")
    .some((part) => cronFieldPartMatches(value, part, min, max));
}

function cronFieldPartMatches(
  value: number,
  part: string,
  min: number,
  max: number,
): boolean {
  const [rangePart, stepStr] = part.split("/", 2);
  const hasStep = stepStr !== undefined;
  const step = hasStep ? parseInt(stepStr, 10) : 1;
  const range = parseCronRange(rangePart, min, max, hasStep);
  return rangeMatches(value, range.start, range.end, step);
}

function parseCronRange(
  rangePart: string,
  min: number,
  max: number,
  hasStep: boolean,
): { readonly start: number; readonly end: number } {
  if (rangePart === "*") return { start: min, end: max };
  if (!rangePart.includes("-")) {
    const value = parseInt(rangePart, 10);
    // A bare value with a step (`N/step`) means "from N through max, every
    // step"; without a step it matches only N.
    return { start: value, end: hasStep ? max : value };
  }

  const [startStr, endStr] = rangePart.split("-", 2);
  return { start: parseInt(startStr, 10), end: parseInt(endStr, 10) };
}

function rangeMatches(
  value: number,
  start: number,
  end: number,
  step: number,
): boolean {
  return [
    step > 0,
    Number.isFinite(start),
    Number.isFinite(end),
    value >= start,
    value <= end,
    (value - start) % step === 0,
  ].every(Boolean);
}

/** Normalise a GitHub remote URL or owner/repo string to an owner/repo slug. */
export function normalizeGitHubSlug(value: string): string | null {
  let slug = value.trim();
  if (slug.startsWith("git@github.com:")) {
    slug = slug.slice("git@github.com:".length);
  } else if (slug.startsWith("ssh://git@github.com/")) {
    slug = slug.slice("ssh://git@github.com/".length);
  } else if (slug.startsWith("https://github.com/")) {
    slug = slug.slice("https://github.com/".length);
  } else if (slug.startsWith("http://github.com/")) {
    slug = slug.slice("http://github.com/".length);
  } else if (slug.startsWith("git://github.com/")) {
    slug = slug.slice("git://github.com/".length);
  }

  slug = slug.replace(/\.git$/, "").replace(/\/$/, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug) ? slug : null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
