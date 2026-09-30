import { Effect, FileSystem, Schema } from "effect";
import { basename, relative, resolve } from "node:path";
import { isAgent } from "../lib/agent.js";
import { Config } from "../services/Config.js";
import type { GitRepoShortcut } from "../services/GitConfig.js";

/** Tracked repositories could not be read from private `dot-git.yml`. */
class ReposError extends Schema.TaggedError<ReposError>()("ReposError", {
  message: Schema.String,
}) {}

/** One tracked repository or shortcut from private `dot-git.yml`. */
export interface TrackedRepo {
  /** Picker label, also used as the Herdr workspace label. */
  readonly name: string;
  /** Absolute checkout path. */
  readonly path: string;
  /** GitHub `owner/repo` slug, or null for a path-only shortcut. */
  readonly github: string | null;
  /** Zsh shortcut aliases that open this repository. */
  readonly aliases: readonly string[];
  /** Whether the entry is a managed repository or a path-only shortcut. */
  readonly kind: "repository" | "shortcut";
  /** Whether the checkout path currently exists. */
  readonly exists: boolean;
  /** Whether this is the deepest tracked path containing the working directory. */
  readonly current: boolean;
}

function isInside(path: string, cwd: string): boolean {
  const offset = relative(path, cwd);

  return offset === "" || (!offset.startsWith("..") && !offset.startsWith("/"));
}

/** Rank a repository against a query: 0 exact, 1 partial, undefined no match. */
function matchRank(repo: TrackedRepo, query: string): number | undefined {
  const needle = query.toLowerCase();

  const keys = [
    repo.name,
    ...repo.aliases,
    basename(repo.path),
    ...(repo.github ? [repo.github, repo.github.split("/")[1] ?? ""] : []),
  ].map((key) => key.toLowerCase());

  if (keys.includes(needle)) return 0;

  if ([...keys, repo.path.toLowerCase()].some((key) => key.includes(needle)))
    return 1;

  return undefined;
}

function renderTable(repos: readonly TrackedRepo[]): string {
  const width = Math.max(...repos.map((repo) => repo.name.length));

  return repos
    .map((repo) => {
      const notes = [
        repo.github,
        repo.current ? "current" : null,
        repo.exists ? null : "missing",
      ].filter((note) => note !== null);

      return `${repo.name.padEnd(width)}  ${repo.path}${notes.length ? `  (${notes.join(", ")})` : ""}`;
    })
    .join("\n");
}

/**
 * List tracked repositories and shortcuts from private `dot-git.yml`,
 * optionally filtered by a name, alias, GitHub slug or path query. Prints JSON
 * with `--json` or under an AI agent, and exits 1 when a query matches nothing.
 */
export const repos = Effect.fn("repos")(function* (options: {
  readonly query?: string;
  readonly json: boolean;
}) {
  const config = yield* Config;
  const fs = yield* FileSystem.FileSystem;

  if (!config.canUsePrivate)
    return yield* new ReposError({
      message: `Tracked repositories are unavailable: ${config.privateReason}`,
    });

  if (!config.gitConfig.present)
    return yield* new ReposError({
      message: `No tracked repositories: ${config.gitConfig.filePath} is missing`,
    });

  if (!config.gitConfig.valid)
    return yield* new ReposError({
      message: config.gitConfig.diagnostics.join("; "),
    });

  const cwd = resolve(process.cwd());

  const currentPath = [
    ...config.gitConfig.repositories,
    ...config.gitConfig.shortcuts,
  ]
    .flatMap((entry) => (isInside(entry.path, cwd) ? [entry.path] : []))
    .sort((a, b) => b.length - a.length)[0];

  const entries: readonly (readonly [GitRepoShortcut, string | null])[] = [
    ...config.gitConfig.repositories.map(
      (repo) => [repo, repo.github] as const,
    ),
    ...config.gitConfig.shortcuts.map((shortcut) => [shortcut, null] as const),
  ];

  const tracked = yield* Effect.forEach(entries, ([entry, github]) =>
    fs.exists(entry.path).pipe(
      Effect.orElseSucceed(() => false),
      Effect.map((exists): TrackedRepo => ({
        name: entry.name,
        path: entry.path,
        github,
        aliases: entry.aliases,
        kind: github === null ? "shortcut" : "repository",
        exists,
        current: entry.path === currentPath,
      })),
    ),
  );

  const query = options.query?.trim();

  const selected = query
    ? tracked
        .flatMap((repo) => {
          const rank = matchRank(repo, query);

          return rank === undefined ? [] : [{ repo, rank }];
        })
        .sort((a, b) => a.rank - b.rank)
        .map(({ repo }) => repo)
    : tracked;

  if (options.json || isAgent())
    process.stdout.write(`${JSON.stringify(selected, null, 2)}\n`);
  else if (selected.length > 0)
    process.stdout.write(`${renderTable(selected)}\n`);

  if (query && selected.length === 0) {
    process.stderr.write(`No tracked repository matches "${query}"\n`);
    process.exitCode = 1;
  }
});
