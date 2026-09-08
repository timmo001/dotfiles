import { Effect, Schema } from "effect";
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { isAbsolute, join, relative } from "path";
import { isDeepStrictEqual } from "node:util";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import {
  parseDotGitConfigText,
  type DotGitConfig,
  type GitManagedRepo,
} from "../services/GitConfig.js";
import { decodeJson, formatCause, isJsonObject } from "./schema.js";
import { displayPath } from "./paths.js";

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

const git = Effect.fn("gitRepoConfig.git")(function* (
  privateRoot: string,
  args: readonly string[],
) {
  const executor = yield* CommandExecutor;
  return yield* executor.run("git", args, { cwd: privateRoot }).pipe(
    Effect.mapError(
      (error) =>
        new GitRepoConfigError({
          message: `Private config Git check failed: ${error.stderr}`,
        }),
    ),
  );
});

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
    const paths = yield* Effect.try({
      try: () => ({
        privateRoot: realpathSync(privateDotfiles),
        file: realpathSync(config.gitConfig.filePath),
      }),
      catch: (error) =>
        new GitRepoConfigError({
          message: `Could not resolve private config: ${formatCause(error)}`,
        }),
    });
    const configPath = relative(paths.privateRoot, paths.file);
    if (!configPath || configPath.startsWith("..") || isAbsolute(configPath)) {
      return yield* new GitRepoConfigError({
        message: "Config must be inside dotfiles-private",
      });
    }
    yield* checkCleanConfig(paths.privateRoot, configPath);
    const source = yield* Effect.try({
      try: () => readFileSync(paths.file, "utf-8"),
      catch: (error) =>
        new GitRepoConfigError({
          message: `Could not read private config: ${formatCause(error)}`,
        }),
    });
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
      const executable = yield* Effect.sync(() => {
        try {
          accessSync(hookPath, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
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
    yield* Effect.try({
      try: () => {
        if (readFileSync(edit.file, "utf-8") !== edit.source)
          throw new Error(
            "Private config changed since it was read; run the command again",
          );
        writeFileSync(edit.file, updated);
      },
      catch: (error) => new GitRepoConfigError({ message: formatCause(error) }),
    });
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
    const directory = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const directory = mkdtempSync(join(config.cacheDir, "repo-induct-"));
          return directory;
        },
        catch: (error) =>
          new GitRepoConfigError({ message: formatCause(error) }),
      }),
      (directory) =>
        Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
    );
    yield* Effect.try({
      try: () => {
        mkdirSync(join(directory, "before"));
        mkdirSync(join(directory, "after"));
        writeFileSync(join(directory, "before/dot-git.yml"), edit.source);
        writeFileSync(join(directory, "after/dot-git.yml"), updated);
      },
      catch: (error) => new GitRepoConfigError({ message: formatCause(error) }),
    });
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
  if (repo.postUpdate !== null)
    Object.assign(entry, { post_update: repo.postUpdate });
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const block = [
    `  - name: ${JSON.stringify(entry.name)}`,
    `    path: ${JSON.stringify(entry.path)}`,
    `    github: ${JSON.stringify(entry.github)}`,
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
    "    activity:",
    `      enabled: ${entry.activity.enabled}`,
    `      schedule: ${JSON.stringify(entry.activity.schedule)}`,
    "    notifications:",
    `      enabled: ${entry.notifications.enabled}`,
    `      schedule: ${JSON.stringify(entry.notifications.schedule)}`,
    "      bar:",
    `        ignore_bot_activity: ${entry.notifications.bar.ignore_bot_activity}`,
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
