import { Effect, FileSystem, Schema } from "effect";
import { isAbsolute, join, relative } from "path";
import { isDeepStrictEqual } from "node:util";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import {
  AgentLintSettings,
  parseDotGitConfigText,
  type DotGitConfig,
  type GitManagedRepo,
} from "../services/GitConfig.js";
import { decodeJson, formatCause, isJsonObject } from "./schema.js";
import type { ReleaseSettings } from "../git/release/types.js";
import { displayPath } from "./paths.js";
import { gitOutput } from "./git.js";

/** Failure to prepare, validate or commit a bounded private repository config edit. */
export class GitRepoConfigError extends Schema.TaggedError<GitRepoConfigError>()(
  "GitRepoConfigError",
  {
    message: Schema.String,
  },
) {}

/** Immutable source snapshot shared by induction and single-field opt-in. */
export interface GitRepoConfigEdit {
  /** Owning private repository. */
  readonly privateRoot: string;
  /** Canonical config file path. */
  readonly file: string;
  /** Literal path relative to the private repository. */
  readonly configPath: string;
  /** Original bytes to compare immediately before writing. */
  readonly source: string;
  /** Validated config corresponding to the original bytes. */
  readonly config: DotGitConfig;
}

const git = (privateRoot: string, args: readonly string[]) =>
  gitOutput(args, { cwd: privateRoot }).pipe(
    Effect.mapError(
      (error) =>
        new GitRepoConfigError({
          message: `Private config Git check failed: ${error.message}`,
        }),
    ),
  );

const checkCleanConfig = Effect.fn("gitRepoConfig.checkClean")(function* (
  privateRoot: string,
  configPath: string,
) {
  yield* git(privateRoot, ["ls-files", "--error-unmatch", "--", configPath]);

  if (
    (yield* git(privateRoot, [
      "status",
      "--porcelain",
      "--",
      configPath,
    ])).trim()
  ) {
    return yield* new GitRepoConfigError({
      message:
        "Private config has staged or unstaged changes; commit or restore them first",
    });
  }
});

/** Read a clean, validated private config without changing the worktree or index. */
export const prepareGitRepoConfigEdit = Effect.fn("gitRepoConfig.prepare")(
  function* () {
    const config = yield* Config;
    const privateDotfiles = config.privateDotfiles;

    if (!privateDotfiles || !config.canUsePrivate) {
      return yield* new GitRepoConfigError({
        message: "Private git config is unavailable",
      });
    }

    const fs = yield* FileSystem.FileSystem;

    const paths = yield* Effect.all({
      privateRoot: fs.realPath(privateDotfiles),
      file: fs.realPath(config.gitConfig.filePath),
    }).pipe(
      Effect.mapError(
        (error) =>
          new GitRepoConfigError({
            message: `Could not resolve private config: ${formatCause(error)}`,
          }),
      ),
    );

    const configPath = relative(paths.privateRoot, paths.file);

    if (!configPath || configPath.startsWith("..") || isAbsolute(configPath)) {
      return yield* new GitRepoConfigError({
        message: "Config must be inside dotfiles-private",
      });
    }

    yield* checkCleanConfig(paths.privateRoot, configPath);

    const source = yield* fs.readFileString(paths.file).pipe(
      Effect.mapError(
        (error) =>
          new GitRepoConfigError({
            message: `Could not read private config: ${formatCause(error)}`,
          }),
      ),
    );

    const parsed = parseDotGitConfigText(source, paths.file);

    if (!parsed.valid)
      return yield* new GitRepoConfigError({
        message: parsed.diagnostics.join("\n"),
      });

    return {
      ...paths,
      configPath,
      source,
      config: parsed,
    } satisfies GitRepoConfigEdit;
  },
);

/** Commit only the proposed config edit, preserving unrelated staged files. */
export const commitGitRepoConfigEdit = Effect.fn("gitRepoConfig.commit")(
  function* (edit: GitRepoConfigEdit, updated: string, message: string) {
    if (updated === edit.source) return;
    const parsed = parseDotGitConfigText(updated, edit.file);

    if (!parsed.valid)
      return yield* new GitRepoConfigError({
        message: parsed.diagnostics.join("\n"),
      });
    const executor = yield* CommandExecutor;
    const fs = yield* FileSystem.FileSystem;

    for (const hook of [
      "pre-commit",
      "prepare-commit-msg",
      "commit-msg",
      "post-commit",
    ]) {
      const hookPath = (yield* git(edit.privateRoot, [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        `hooks/${hook}`,
      ])).trim();

      const executable = yield* fs.stat(hookPath).pipe(
        Effect.map((info) => (info.mode & 0o111) !== 0),
        Effect.orElseSucceed(() => false),
      );

      if (executable)
        return yield* new GitRepoConfigError({
          message: `${hook} hook is active; cannot preserve the exact config change without bypassing hooks`,
        });
    }

    yield* executor
      .run("dot", ["git-commit", "--help"], { cwd: edit.privateRoot })
      .pipe(
        Effect.mapError(
          () =>
            new GitRepoConfigError({
              message: "dot git-commit is unavailable",
            }),
        ),
      );
    yield* checkCleanConfig(edit.privateRoot, edit.configPath);
    yield* Effect.gen(function* () {
      if ((yield* fs.readFileString(edit.file)) !== edit.source)
        return yield* new GitRepoConfigError({
          message:
            "Private config changed since it was read; run the command again",
        });
      yield* fs.writeFileString(edit.file, updated);
    }).pipe(
      Effect.mapError(
        (error) => new GitRepoConfigError({ message: formatCause(error) }),
      ),
    );

    const exit = yield* executor.inherit(
      "dot",
      ["git-commit", "--message", message, "--path", edit.configPath],
      { cwd: edit.privateRoot },
    );

    if (exit !== 0)
      return yield* new GitRepoConfigError({
        message: "Config commit failed; the proposed edit remains for review",
      });
  },
);

/** Print the exact proposed diff without writing the real config. */
export const previewGitRepoConfigEdit = Effect.fn("gitRepoConfig.preview")(
  function* (edit: GitRepoConfigEdit, updated: string) {
    const config = yield* Config;
    const executor = yield* CommandExecutor;
    const fs = yield* FileSystem.FileSystem;

    const directory = yield* Effect.acquireRelease(
      fs
        .makeTempDirectory({
          directory: config.cacheDir,
          prefix: "repo-induct-",
        })
        .pipe(
          Effect.mapError(
            (error) => new GitRepoConfigError({ message: formatCause(error) }),
          ),
        ),
      (directory) =>
        fs
          .remove(directory, { recursive: true, force: true })
          .pipe(Effect.ignore),
    );

    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(join(directory, "before"));
      yield* fs.makeDirectory(join(directory, "after"));
      yield* fs.writeFileString(
        join(directory, "before/dot-git.yml"),
        edit.source,
      );
      yield* fs.writeFileString(join(directory, "after/dot-git.yml"), updated);
    }).pipe(
      Effect.mapError(
        (error) => new GitRepoConfigError({ message: formatCause(error) }),
      ),
    );

    const exit = yield* executor.inherit(
      "git",
      [
        "--no-pager",
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--",
        "before/dot-git.yml",
        "after/dot-git.yml",
      ],
      { cwd: directory },
    );

    if (exit > 1)
      return yield* new GitRepoConfigError({
        message: "Could not preview the private config change",
      });
  },
  Effect.scoped,
);

/** Append a block-style repository entry while preserving every existing byte. */
export function appendGitRepository(
  source: string,
  repo: GitManagedRepo,
): string {
  const original = decodeJson(Bun.YAML.parse(source));

  if (!isJsonObject(original) || !Array.isArray(original.repositories))
    throw new Error("Invalid repository config");

  const agentLint =
    repo.agentLint && Schema.encodeSync(AgentLintSettings)(repo.agentLint);

  const entry = {
    name: repo.name,
    path: displayPath(repo.path),
    github: repo.github,
    aliases: repo.aliases,
    agent_oxlint: repo.agentOxlint,
    activity: repo.activity,
    notifications: {
      enabled: repo.notifications.enabled,
      schedule: repo.notifications.schedule,
      bar: { ignore_bot_activity: repo.notifications.bar.ignoreBotActivity },
    },
  };

  if (repo.herdrAfter) Object.assign(entry, { herdr_after: repo.herdrAfter });

  if (repo.browser) Object.assign(entry, { browser: repo.browser });

  if (repo.notesRemote)
    Object.assign(entry, { notes_remote: repo.notesRemote });

  if (repo.postUpdate !== null)
    Object.assign(entry, { post_update: repo.postUpdate });

  if (agentLint) Object.assign(entry, { agent_lint: agentLint });

  if (repo.pullRequests)
    Object.assign(entry, { pull_requests: repo.pullRequests });

  if (repo.releases) Object.assign(entry, { releases: repo.releases });

  if (repo.opencodeMcp?.length)
    Object.assign(entry, { opencode_mcp: repo.opencodeMcp });
  const newline = source.includes("\r\n") ? "\r\n" : "\n";

  const nested = (
    key: string,
    value: typeof AgentLintSettings.Encoded | ReleaseSettings,
  ) => [
    `    ${key}:`,
    ...Bun.YAML.stringify(value, null, 2)
      .replace(/:[ \t]*\n\s+(\[\]|\{\})[ \t]*$/gm, ": $1")
      .trimEnd()
      .split("\n")
      .map((line) => `      ${line.trimEnd()}`),
  ];

  const block = [
    `  - name: ${JSON.stringify(entry.name)}`,
    ...(repo.herdrAfter
      ? [`    herdr_after: ${JSON.stringify(repo.herdrAfter)}`]
      : []),
    `    path: ${JSON.stringify(entry.path)}`,
    ...(repo.browser ? [`    browser: ${JSON.stringify(repo.browser)}`] : []),
    `    github: ${JSON.stringify(entry.github)}`,
    ...(repo.notesRemote
      ? [`    notes_remote: ${JSON.stringify(repo.notesRemote)}`]
      : []),
    ...(entry.aliases.length
      ? [
          "    aliases:",
          ...entry.aliases.map((alias) => `      - ${JSON.stringify(alias)}`),
        ]
      : ["    aliases: []"]),
    ...(repo.postUpdate === null
      ? []
      : [`    post_update: ${JSON.stringify(repo.postUpdate)}`]),
    `    agent_oxlint: ${entry.agent_oxlint}`,
    ...(agentLint ? nested("agent_lint", agentLint) : []),
    ...(repo.opencodeMcp?.length
      ? [
          "    opencode_mcp:",
          ...repo.opencodeMcp.map((name) => `      - ${JSON.stringify(name)}`),
        ]
      : []),
    ...(repo.pullRequests
      ? ["    pull_requests:", `      enabled: ${repo.pullRequests.enabled}`]
      : []),
    "    activity:",
    `      enabled: ${entry.activity.enabled}`,
    `      schedule: ${JSON.stringify(entry.activity.schedule)}`,
    "    notifications:",
    `      enabled: ${entry.notifications.enabled}`,
    `      schedule: ${JSON.stringify(entry.notifications.schedule)}`,
    "      bar:",
    `        ignore_bot_activity: ${entry.notifications.bar.ignore_bot_activity}`,
    ...(repo.releases ? nested("releases", repo.releases) : []),
    "",
  ].join(newline);

  const expected = Object.assign({}, original, {
    repositories: [...original.repositories, entry],
  });

  if (original.repositories.length === 0) {
    const empty =
      /^repositories:([ \t]*)\[\]([ \t]*(?:#[^\r\n]*)?)(\r?\n|$)/m.exec(source);

    if (!empty)
      throw new Error("An empty repositories list must use repositories: []");

    const candidate =
      source.slice(0, empty.index) +
      `repositories:${empty[1]}${empty[2]}`.trimEnd() +
      (empty[3] || newline) +
      block +
      source.slice(empty.index + empty[0].length);

    if (!isDeepStrictEqual(decodeJson(Bun.YAML.parse(candidate)), expected))
      throw new Error("Could not expand the empty repositories list");

    return candidate;
  }

  // Validate candidate insertion points instead of reserialising the document.
  const offsets = [...source.matchAll(/^[^\s#].*/gm)].map(
    (match) => match.index,
  );

  offsets.push(source.length);
  const candidates: string[] = [];

  for (const offset of offsets) {
    const before = source.slice(0, offset);

    const candidate =
      before +
      (before.endsWith("\n") ? "" : newline) +
      block +
      source.slice(offset);

    try {
      if (isDeepStrictEqual(decodeJson(Bun.YAML.parse(candidate)), expected))
        candidates.push(candidate);
    } catch {
      continue;
    }
  }

  if (candidates.length !== 1)
    throw new Error(
      "Cannot append a repository to this block-style YAML config without changing existing content",
    );

  return candidates[0];
}
