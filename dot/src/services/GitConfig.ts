import { join } from "path";
import { Cron, Duration, Effect, FileSystem, Schema } from "effect";
import { ReleaseSettings } from "../git/release/types.js";
import { displayPath, expandHomePath } from "../lib/paths.js";
import {
  decodeJson,
  formatCause,
  isJsonObject,
  isString,
  type JsonValue,
} from "../lib/schema.js";
import {
  optionalString,
  pushUnknownKeyDiagnostics,
  requiredBoolean,
  requiredString,
} from "../lib/configDiagnostics.js";

const TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "repositories",
  "shortcuts",
  "browsers",
  "issues",
]);

const REPO_KEYS = new Set([
  "name",
  "path",
  "github",
  "aliases",
  "post_update",
  "agent_oxlint",
  "agent_lint",
  "notes_remote",
  "opencode_mcp",
  "omarchy_components",
  "browser",
  "review_search",
  "activity",
  "notifications",
  "pull_requests",
  "issues",
  "releases",
  "herdr_after",
]);

const CHECK_KEYS = new Set(["enabled", "schedule"]);

const NOTIFICATION_KEYS = new Set(["enabled", "schedule", "bar"]);

const NOTIFICATION_BAR_KEYS = new Set(["ignore_bot_activity"]);

const SHORTCUT_KEYS = new Set(["name", "path", "aliases", "herdr_after"]);

/** A shell shortcut target generated from private git configuration. */
export interface GitRepoShortcut {
  /** Friendly Herdr workspace label. */
  readonly name: string;
  /** Absolute filesystem path. */
  readonly path: string;
  /** Generated shell function names. */
  readonly aliases: readonly string[];
  /** Workspace label a new Herdr workspace for this entry opens after. */
  readonly herdrAfter?: string;
}

/** Git checks that can be independently toggled and scheduled. */
export type GitRepoCheckName = "activity";

/** Explicit per-check config for a managed git repository. */
export interface GitRepoCheckConfig {
  /** Whether this check is enabled for the repository. */
  readonly enabled: boolean;
  /** Five-field local cron expression or the shared `work` schedule. */
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

/** Shared Omarchy panel components copied into a standalone plugin checkout. */
export interface GitRepoOmarchyComponents {
  /** Plugin directory relative to the repository root. */
  readonly directory: string;
  /** Component names copied from the dotfiles components directory. */
  readonly components: readonly string[];
}

const OmarchyComponentsSettings = Schema.Struct({
  directory: Schema.String,
  components: Schema.NonEmptyArray(
    Schema.String.check(Schema.isPattern(/^[A-Z][A-Za-z0-9]*$/)),
  ),
});

/** One fallback lint command run by `dot agent lint`. */
export const AgentLintCommand = Schema.Struct({
  /** Display name shown in results, such as `Typecheck` or `GitHub Actions`. */
  name: Schema.String.check(Schema.isPattern(/^\S(?:.*\S)?$/)),
  /** Argv run from the repository root; a `{files}` argument expands to the matching changed files. */
  run: Schema.NonEmptyArray(Schema.NonEmptyString),
  /** Repository-relative globs; the command only runs when a changed file matches. */
  include: Schema.optionalKey(Schema.NonEmptyArray(Schema.NonEmptyString)),
  /** Deadline for the command, such as `60 seconds`. */
  timeout: Schema.optionalKey(Schema.DurationFromString),
});

/** Decoded {@link AgentLintCommand}. */
export type AgentLintCommand = typeof AgentLintCommand.Type;

/** Per-repository fallback lint commands for agent sessions. */
export const AgentLintSettings = Schema.Struct({
  /** Commands run in parallel; results keep this order. */
  commands: Schema.NonEmptyArray(AgentLintCommand),
  /** Closing line of the lint message, naming the repository's own checks. */
  message: Schema.optionalKey(Schema.NonEmptyString),
});

/** Decoded {@link AgentLintSettings}. */
export type AgentLintSettings = typeof AgentLintSettings.Type;

/** Hides matching issues from the Git panel; every field set must match, case-insensitively. */
export const IssueExclusion = Schema.Struct({
  /** Exact issue title. */
  title: Schema.optionalKey(Schema.NonEmptyString),
  /** Issue author login, such as `renovate[bot]`. */
  author: Schema.optionalKey(Schema.NonEmptyString),
  /** Label the issue carries. */
  label: Schema.optionalKey(Schema.NonEmptyString),
  /** GitHub owner/repo slug; omitted applies to every repository. */
  repo: Schema.optionalKey(Schema.NonEmptyString),
});

/** Decoded {@link IssueExclusion}. */
export type IssueExclusion = typeof IssueExclusion.Type;

const IssueSettings = Schema.Struct({
  exclude: Schema.Array(
    IssueExclusion.check(
      Schema.makeFilter((rule) =>
        rule.title || rule.author || rule.label
          ? undefined
          : "an exclusion needs a title, author or label",
      ),
    ),
  ),
});

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
  /** Workspace label a new Herdr workspace for this repository opens after. */
  readonly herdrAfter?: string;
  /** Command run from the repository root after `dot update` pulls a new HEAD. */
  readonly postUpdate: string | null;
  /** Whether the dot-managed generic Oxlint pass may run without a local setup. */
  readonly agentOxlint: boolean;
  /** Fallback lint commands `dot agent lint` runs on changed files; omitted means disabled. */
  readonly agentLint?: AgentLintSettings;
  /** Git remote notes resolves this checkout against, written to its local `notes.remote` config. */
  readonly notesRemote?: string;
  /** MCP server names explicitly enabled for this repository by dot mcp sync. */
  readonly opencodeMcp?: readonly string[];
  /** Shared Omarchy components synced by dot omarchy plugin sync components. */
  readonly omarchyComponents?: GitRepoOmarchyComponents;
  /** Named browser for repository web actions; omitted uses the desktop default. */
  readonly browser?: string;
  /** GitHub pull request search used by dot pr queue; the repository qualifier is added when missing. */
  readonly reviewSearch?: string;
  /** Local activity check used by git diff and repository updates. */
  readonly activity: GitRepoCheckConfig;
  /** GitHub notification check and status-bar filters. */
  readonly notifications: GitRepoNotificationConfig;
  /** Whether open pull requests appear in the Git panel; omitted means disabled. */
  readonly pullRequests?: {
    /** Include this repository in PR polling and panel pages. */
    readonly enabled: boolean;
  };
  /** Whether open issues appear in the Git panel; omitted means disabled. */
  readonly issues?: {
    /** Include this repository in issue polling and panel pages. */
    readonly enabled: boolean;
  };
  /** Optional release comparison policy and schedule; omitted means disabled. */
  readonly releases?: ReleaseSettings;
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
  /** Named browser commands, with the URL appended as one argument. */
  readonly browsers: Readonly<Record<string, readonly string[]>>;
  /** Issues hidden from the Git panel across tracked repositories. */
  readonly issueExclusions: readonly IssueExclusion[];
  /** Validation diagnostics for missing or malformed config. */
  readonly diagnostics: readonly string[];
}

interface ParsedGitConfig {
  readonly browsers: Readonly<Record<string, readonly string[]>>;
  readonly issueExclusions: readonly IssueExclusion[];
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
    browsers: {},
    issueExclusions: [],
    diagnostics,
  };
}

/** Load and strictly validate the private dot git YAML config. */
export const loadDotGitConfig = Effect.fn("GitConfig.load")(function* (
  filePath: string,
) {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false)))) {
    return emptyDotGitConfig(filePath, [
      `Missing private git config: ${displayPath(filePath)}`,
    ]);
  }

  return yield* fs.readFileString(filePath).pipe(
    Effect.flatMap((text) =>
      Effect.try(() => parseDotGitConfigText(text, filePath)),
    ),
    Effect.catch((error) =>
      Effect.succeed<DotGitConfig>({
        filePath,
        present: true,
        valid: false,
        repositories: [],
        shortcuts: [],
        browsers: {},
        issueExclusions: [],
        diagnostics: [
          `Could not read private git config ${displayPath(filePath)}: ${formatError(error.cause)}`,
        ],
      }),
    ),
  );
});

/** Validate a proposed config in memory using the same rules as the file loader. */
export function parseDotGitConfigText(
  source: string,
  filePath: string,
): DotGitConfig {
  try {
    const result = parseDotGitConfig(decodeJson(Bun.YAML.parse(source)));

    return {
      filePath,
      present: true,
      valid: result.diagnostics.length === 0,
      repositories: result.diagnostics.length === 0 ? result.repositories : [],
      shortcuts: result.diagnostics.length === 0 ? result.shortcuts : [],
      browsers: result.diagnostics.length === 0 ? result.browsers : {},
      issueExclusions:
        result.diagnostics.length === 0 ? result.issueExclusions : [],
      diagnostics: result.diagnostics,
    };
  } catch (error) {
    return {
      ...emptyDotGitConfig(filePath, [formatError(error)]),
      present: true,
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
  workTimeActive = false,
): readonly GitManagedRepo[] {
  return enabledGitReposForCheck(gitConfig, check).filter((repo) =>
    gitRepoCheckActive(repo, check, now, workTimeActive),
  );
}

/** Return repositories with the selected check enabled, regardless of schedule. */
export function enabledGitReposForCheck(
  gitConfig: DotGitConfig,
  check: GitRepoCheckName,
): readonly GitManagedRepo[] {
  return managedGitRepos(gitConfig).filter((repo) => repo[check].enabled);
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
  workTimeActive = false,
): boolean {
  const config = repo[check];

  return (
    config.enabled &&
    (config.schedule === "work"
      ? workTimeActive
      : cronScheduleActive(config.schedule, now))
  );
}

/** Check whether a repository notification check is enabled and currently in schedule. */
export function gitRepoNotificationsActive(
  repo: GitManagedRepo,
  now: Date = new Date(),
  workTimeActive = false,
): boolean {
  return (
    repo.notifications.enabled &&
    (repo.notifications.schedule === "work"
      ? workTimeActive
      : cronScheduleActive(repo.notifications.schedule, now))
  );
}

function parseDotGitConfig(value: JsonValue): ParsedGitConfig {
  const diagnostics: string[] = [];

  if (!isRecord(value)) {
    return {
      repositories: [],
      shortcuts: [],
      diagnostics: ["dot-git.yml must contain a YAML object"],
      browsers: {},
      issueExclusions: [],
    };
  }

  pushUnknownKeyDiagnostics(diagnostics, value, TOP_LEVEL_KEYS, "root");

  if (value.schema_version !== 2) {
    diagnostics.push("root.schema_version must be 2");
  }

  if (!Array.isArray(value.repositories)) {
    diagnostics.push("root.repositories must be an array");

    return {
      repositories: [],
      shortcuts: [],
      browsers: {},
      issueExclusions: [],
      diagnostics,
    };
  }

  const repositories = value.repositories.flatMap((repo, index) =>
    parseRepo(repo, index, diagnostics),
  );

  const shortcuts = parseShortcuts(value.shortcuts, diagnostics);
  const browsers: Record<string, readonly string[]> = {};

  if (value.browsers !== undefined) {
    if (!isRecord(value.browsers))
      diagnostics.push("root.browsers must be an object");
    else
      for (const [name, command] of Object.entries(value.browsers)) {
        if (
          !/^[a-z][a-z0-9_-]*$/.test(name) ||
          !Array.isArray(command) ||
          command.length === 0 ||
          !command.every(
            (arg): arg is string => isString(arg) && arg.trim().length > 0,
          )
        ) {
          diagnostics.push(
            `root.browsers.${name} must be a non-empty command argument list with a lowercase name`,
          );
        } else browsers[name] = command;
      }
  }

  for (const repo of repositories) {
    if (repo.browser && !Object.hasOwn(browsers, repo.browser))
      diagnostics.push(
        `Repository ${repo.name} references unknown browser: ${repo.browser}`,
      );
  }

  let issueExclusions: readonly IssueExclusion[] = [];

  if (value.issues !== undefined) {
    try {
      issueExclusions = Schema.decodeUnknownSync(IssueSettings)(value.issues, {
        onExcessProperty: "error",
      }).exclude;
    } catch (error) {
      diagnostics.push(`root.issues: ${formatError(error)}`);
    }
  }

  pushDuplicateDiagnostics(diagnostics, repositories, "name");
  pushDuplicateDiagnostics(diagnostics, repositories, "path");
  pushDuplicateDiagnostics(diagnostics, repositories, "github");
  pushDuplicateAliasDiagnostics(diagnostics, [...repositories, ...shortcuts]);

  return { repositories, shortcuts, browsers, issueExclusions, diagnostics };
}

function parseShortcuts(
  value: JsonValue,
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

    const herdrAfter = optionalString(
      shortcut.herdr_after,
      `${location}.herdr_after`,
      diagnostics,
    );

    return name && path
      ? [
          {
            name,
            path: expandHomePath(path),
            aliases,
            ...(herdrAfter && { herdrAfter }),
          },
        ]
      : [];
  });
}

function parseRepo(
  value: JsonValue,
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

  const herdrAfter = optionalString(
    value.herdr_after,
    `${location}.herdr_after`,
    diagnostics,
  );

  const agentOxlint = optionalBoolean(
    value.agent_oxlint,
    `${location}.agent_oxlint`,
    diagnostics,
  );

  const agentLint = parseAgentLint(
    value.agent_lint,
    `${location}.agent_lint`,
    diagnostics,
  );

  const notesRemote = optionalString(
    value.notes_remote,
    `${location}.notes_remote`,
    diagnostics,
  );

  if (notesRemote && !/^[A-Za-z0-9._-]+$/.test(notesRemote))
    diagnostics.push(`${location}.notes_remote must be a Git remote name`);

  const opencodeMcp =
    value.opencode_mcp === undefined
      ? []
      : Schema.decodeUnknownSync(Schema.Array(Schema.NonEmptyString))(
          value.opencode_mcp,
        );

  if (new Set(opencodeMcp).size !== opencodeMcp.length)
    diagnostics.push(
      `${location}.opencode_mcp must contain unique server names`,
    );

  const omarchyComponents = parseOmarchyComponents(
    value.omarchy_components,
    `${location}.omarchy_components`,
    diagnostics,
  );

  const browser = optionalString(
    value.browser,
    `${location}.browser`,
    diagnostics,
  );

  const reviewSearch = optionalString(
    value.review_search,
    `${location}.review_search`,
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

  const pullRequests =
    value.pull_requests === undefined
      ? undefined
      : Schema.decodeUnknownSync(Schema.Struct({ enabled: Schema.Boolean }))(
          value.pull_requests,
          { onExcessProperty: "error" },
        );

  const issues =
    value.issues === undefined
      ? undefined
      : Schema.decodeUnknownSync(Schema.Struct({ enabled: Schema.Boolean }))(
          value.issues,
          { onExcessProperty: "error" },
        );

  const releases = parseReleases(
    value.releases,
    `${location}.releases`,
    diagnostics,
  );

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
      ...(herdrAfter && { herdrAfter }),
      postUpdate,
      agentOxlint,
      ...(agentLint && { agentLint }),
      ...(notesRemote && { notesRemote }),
      ...(opencodeMcp.length > 0 && { opencodeMcp }),
      ...(omarchyComponents && { omarchyComponents }),
      ...(browser && { browser }),
      ...(reviewSearch && { reviewSearch }),
      activity,
      notifications,
      ...(pullRequests && { pullRequests }),
      ...(issues && { issues }),
      ...(releases && { releases }),
    },
  ];
}

function parseOmarchyComponents(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): GitRepoOmarchyComponents | undefined {
  if (value === undefined) return undefined;

  try {
    const settings = Schema.decodeUnknownSync(OmarchyComponentsSettings)(
      value,
      { onExcessProperty: "error" },
    );

    if (
      settings.directory.startsWith("/") ||
      settings.directory.split("/").includes("..")
    )
      throw new Error("directory must be repository-relative");

    if (new Set(settings.components).size !== settings.components.length)
      throw new Error("components must be unique");

    return settings;
  } catch (error) {
    diagnostics.push(`${location}: ${formatError(error)}`);

    return undefined;
  }
}

function parseAgentLint(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): AgentLintSettings | undefined {
  if (value === undefined) return undefined;

  try {
    const settings = Schema.decodeUnknownSync(AgentLintSettings)(value, {
      onExcessProperty: "error",
    });

    const names = settings.commands.map((command) => command.name);

    if (new Set(names).size !== names.length)
      throw new Error("command names must be unique");

    for (const command of settings.commands) {
      if (command.run.some((arg) => !arg.trim()))
        throw new Error(`${command.name}: run arguments must not be blank`);

      if (
        command.timeout !== undefined &&
        !(
          Duration.isFinite(command.timeout) &&
          Duration.isPositive(command.timeout)
        )
      )
        throw new Error(`${command.name}: timeout must be finite and positive`);
    }

    return settings;
  } catch (error) {
    diagnostics.push(`${location}: ${formatError(error)}`);

    return undefined;
  }
}

function parseReleases(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): ReleaseSettings | undefined {
  if (value === undefined) return undefined;

  try {
    const settings = Schema.decodeUnknownSync(ReleaseSettings)(value, {
      onExcessProperty: "error",
    });

    if (settings.schedule.trim().split(/\s+/).length !== 5)
      throw new Error("schedule must contain five fields");
    Cron.parseUnsafe(settings.schedule);

    if (settings.publish) {
      const paths = settings.publish.version_files.map((file) =>
        isString(file) ? file : file.path,
      );

      for (const file of settings.publish.version_files) {
        const path = isString(file) ? file : file.path;

        if (
          !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(path) ||
          (isString(file)
            ? !path.endsWith(".json")
            : !/(^|\/)setup\.py$/.test(path)) ||
          path.split("/").some((part) => part === ".." || part === "." || !part)
        )
          throw new Error(
            "publish version_files must be repository-relative JSON or explicit setup.py paths",
          );
      }

      if (new Set(paths).size !== paths.length)
        throw new Error("publish version_files must be unique");

      const generated = settings.publish.generated_files ?? [];

      if (
        generated.some(
          (path) =>
            !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(path) ||
            path
              .split("/")
              .some((part) => part === ".." || part === "." || !part),
        ) ||
        new Set(generated).size !== generated.length
      )
        throw new Error(
          "publish generated_files must be unique repository-relative paths",
        );

      for (const command of settings.publish.commands) {
        if (!command.length || command.some((arg) => !arg.trim()))
          throw new Error("publish commands must be non-empty argv arrays");
      }
    }

    if (
      !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(settings.branch) ||
      /\.\.|\/\.|\/\/|\.lock(?:\/|$)|[./]$/.test(settings.branch)
    )
      throw new Error("branch must be a valid branch name");

    if (
      !Number.isInteger(settings.notifications.cooldown_minutes) ||
      settings.notifications.cooldown_minutes < 0
    )
      throw new Error(
        "notification cooldown_minutes must be a non-negative integer",
      );

    if (
      settings.source_minor_threshold !== undefined &&
      (!Number.isInteger(settings.source_minor_threshold) ||
        settings.source_minor_threshold < 0)
    )
      throw new Error("source_minor_threshold must be a non-negative integer");

    for (const path of settings.source_excludes ?? []) {
      if (
        !path.trim() ||
        path.startsWith("/") ||
        path.split("/").includes("..")
      )
        throw new Error(
          "source_excludes must contain non-empty repository-relative globs",
        );
    }

    for (const rule of settings.overrides ?? []) {
      if (!rule.reason.trim())
        throw new Error("override reason must not be empty");

      for (const values of [
        rule.paths,
        rule.dependencies,
        rule.roles,
        rule.submodules,
        rule.change_types,
        rule.subjects,
      ]) {
        if (values && (!values.length || values.some((value) => !value.trim())))
          throw new Error("override match lists must contain non-empty values");
      }

      for (const pattern of rule.subjects ?? []) new RegExp(pattern);

      for (const path of [...(rule.paths ?? []), ...(rule.submodules ?? [])]) {
        if (path.startsWith("/") || path.split("/").includes(".."))
          throw new Error("override paths must be repository-relative");
      }
    }

    return settings;
  } catch (error) {
    diagnostics.push(`${location}: ${formatError(error)}`);

    return undefined;
  }
}

function optionalBoolean(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): boolean {
  if (value === undefined) return false;
  const parsed = requiredBoolean(value, location, diagnostics);

  return parsed ?? false;
}

function optionalAliases(
  value: JsonValue,
  location: string,
  diagnostics: string[],
): readonly string[] {
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    diagnostics.push(`${location} must be an array`);

    return [];
  }

  return value.flatMap((alias, index) => {
    if (!isString(alias) || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(alias)) {
      diagnostics.push(`${location}[${index}] must be a valid shell alias`);

      return [];
    }

    return [alias];
  });
}

function parseNotifications(
  value: JsonValue,
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

  if (schedule && !validGitSchedule(schedule)) {
    diagnostics.push(
      `${location}.schedule must be a five-field cron expression or work`,
    );
  }

  const bar = parseNotificationBar(value.bar, `${location}.bar`, diagnostics);

  return enabled === null || !schedule || !bar
    ? null
    : { enabled, schedule, bar };
}

function parseNotificationBar(
  value: JsonValue,
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
  value: JsonValue,
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

  if (schedule && !validGitSchedule(schedule)) {
    diagnostics.push(
      `${location}.schedule must be a five-field cron expression or work`,
    );
  }

  return enabled === null || !schedule ? null : { enabled, schedule };
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

function validGitSchedule(schedule: string): boolean {
  return schedule === "work" || schedule.trim().split(/\s+/).length === 5;
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

interface CronRange {
  readonly start: number;
  readonly end: number;
}

function parseCronRange(
  rangePart: string,
  min: number,
  max: number,
  hasStep: boolean,
): CronRange {
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

const formatError = formatCause;

const isRecord = isJsonObject;
