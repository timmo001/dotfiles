import {
  HerdrSdk,
  herdrSdkLayerFromOptions,
  type Agent,
  type Workspace,
} from "@timmo001/effect-herdr";
import { Duration, Effect, FileSystem, Option, Schema } from "effect";
import { basename, relative, resolve } from "node:path";
import { isAgent } from "../lib/agent.js";
import { ENV, envString } from "../lib/env.js";
import { Config } from "../services/Config.js";
import type { GitRepoShortcut } from "../services/GitConfig.js";
import { DEFAULT_SOCKET_PATH } from "./HerdrRepoOpen.js";

/** Tracked repositories could not be read from private `dot-git.yml`. */
class ReposError extends Schema.TaggedError<ReposError>()("ReposError", {
  message: Schema.String,
}) {}

/** A Herdr workspace opened for a tracked repository. */
export interface TrackedRepoWorkspace {
  /** Herdr workspace ID, usable with Herdr workspace commands. */
  readonly id: string;
  /** Workspace label. */
  readonly label: string;
  /** Whether this is the focused workspace. */
  readonly focused: boolean;
  /** Number of tabs in the workspace. */
  readonly tabCount: number;
  /** Number of panes in the workspace. */
  readonly paneCount: number;
  /** Aggregate agent status Herdr reports for the workspace. */
  readonly agentStatus: Workspace["agentStatus"];
  /** Checkout the workspace is in, when Herdr detected a Git repository. */
  readonly checkoutPath: string | null;
  /** Whether that checkout is a linked worktree of the tracked repository. */
  readonly linkedWorktree: boolean;
}

/** An agent running in a workspace opened for a tracked repository. */
export interface TrackedRepoAgent {
  /** Unique agent name, when assigned. */
  readonly name: string | null;
  /** Detected agent kind, such as `opencode`. */
  readonly agent: string | null;
  /** Agent status snapshot; not proof that work has completed. */
  readonly status: Agent["status"];
  /** Workspace containing the agent. */
  readonly workspaceId: string;
  /** Pane running the agent. */
  readonly paneId: string;
  /** Whether the agent's pane is focused. */
  readonly focused: boolean;
  /** Foreground working directory, falling back to the pane directory. */
  readonly cwd: string | null;
}

/** Live Herdr state for a tracked repository. */
export interface TrackedRepoHerdr {
  /** Whether any Herdr workspace is open for the repository. */
  readonly open: boolean;
  /** Workspaces labelled with the repository name or in its worktrees. */
  readonly workspaces: readonly TrackedRepoWorkspace[];
  /** Agents running in those workspaces. */
  readonly agents: readonly TrackedRepoAgent[];
}

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
  /** Live Herdr state, or null when the Herdr server could not be reached. */
  readonly herdr: TrackedRepoHerdr | null;
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

/** Read workspaces and agents from the shared Herdr server, if reachable. */
const herdrSnapshot = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;

  return yield* Effect.all(
    { workspaces: herdr.workspaces.list(), agents: herdr.agents.list() },
    { concurrency: 2 },
  );
}).pipe(
  Effect.provide(
    herdrSdkLayerFromOptions({
      socketPath: envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH,
      requestTimeout: Duration.seconds(2),
    }),
  ),
  Effect.catchCause(() => Effect.succeed(undefined)),
  Effect.withSpan("repos.herdrSnapshot"),
);

function repoHerdr(
  repo: Pick<TrackedRepo, "name" | "path">,
  snapshot: {
    readonly workspaces: readonly Workspace[];
    readonly agents: readonly Agent[];
  },
): TrackedRepoHerdr {
  const workspaces = snapshot.workspaces.flatMap(
    (workspace): TrackedRepoWorkspace[] => {
      const worktree = Option.getOrUndefined(workspace.worktree);

      if (workspace.label !== repo.name && worktree?.repoRoot !== repo.path)
        return [];

      return [
        {
          id: workspace.id,
          label: workspace.label,
          focused: workspace.focused,
          tabCount: workspace.tabCount,
          paneCount: workspace.paneCount,
          agentStatus: workspace.agentStatus,
          checkoutPath: worktree?.checkoutPath ?? null,
          linkedWorktree: worktree?.isLinkedWorktree ?? false,
        },
      ];
    },
  );

  const ids = new Set(workspaces.map((workspace) => workspace.id));

  const agents = snapshot.agents.flatMap((agent): TrackedRepoAgent[] =>
    ids.has(agent.workspaceId)
      ? [
          {
            name: Option.getOrNull(agent.name),
            agent: Option.getOrNull(agent.agent),
            status: agent.status,
            workspaceId: agent.workspaceId,
            paneId: agent.paneId,
            focused: agent.focused,
            cwd: Option.getOrNull(
              Option.orElse(agent.foregroundCwd, () => agent.cwd),
            ),
          },
        ]
      : [],
  );

  return { open: workspaces.length > 0, workspaces, agents };
}

/** Searchable fields with their weight in fuzzy search ranking. */
const SEARCH_FIELDS = [
  ["name", 1, (repo: TrackedRepo) => [repo.name]],
  ["alias", 1, (repo: TrackedRepo) => repo.aliases],
  [
    "repo",
    1,
    (repo: TrackedRepo) =>
      repo.github ? [repo.github.split("/")[1] ?? ""] : [],
  ],
  ["github", 0.9, (repo: TrackedRepo) => (repo.github ? [repo.github] : [])],
  ["directory", 0.9, (repo: TrackedRepo) => [basename(repo.path)]],
  ["path", 0.5, (repo: TrackedRepo) => [repo.path]],
] as const;

/** Name of a field that matched a fuzzy search term. */
export type SearchField = (typeof SEARCH_FIELDS)[number][0];

/** A tracked repository ranked by fuzzy search. */
export interface TrackedRepoMatch extends TrackedRepo {
  /** Relevance from 1 to 100; higher is closer. */
  readonly score: number;
  /** Fields that produced the best match for each query term. */
  readonly matched: readonly SearchField[];
}

const compact = (value: string) => value.replace(/[^a-z0-9]/g, "");

/** Optimal string alignment distance, allowing one adjacent transposition. */
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );

  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const row = rows[i];
      const previous = rows[i - 1];

      if (!row || !previous) continue;

      let best = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, (rows[i - 2]?.[j - 2] ?? 0) + 1);

      row[j] = best;
    }

  return rows[a.length]?.[b.length] ?? Math.max(a.length, b.length);
}

/** Span of the shortest in-order occurrence of `term` in `key`, if any. */
function subsequenceSpan(term: string, key: string): number | undefined {
  let best: number | undefined;

  for (
    let start = key.indexOf(term[0] ?? "");
    start !== -1;
    start = key.indexOf(term[0] ?? "", start + 1)
  ) {
    let position = start;

    for (const char of term.slice(1)) {
      position = key.indexOf(char, position + 1);

      if (position === -1) return best;
    }

    const span = position - start + 1;

    if (best === undefined || span < best) best = span;
  }

  return best;
}

/** Score one lower-case query term against one field value, 0 for no match. */
function termScore(term: string, value: string): number {
  const key = value.toLowerCase();
  const words = key.split(/[^a-z0-9]+/).filter(Boolean);
  const termCompact = compact(term);
  const keyCompact = compact(key);

  const direct = (
    [
      [key === term, 100],
      [termCompact !== "" && keyCompact === termCompact, 95],
      [key.startsWith(term), 85],
      [words.some((word) => word.startsWith(term)), 75],
      [key.includes(term), 65],
      [termCompact !== "" && keyCompact.includes(termCompact), 60],
    ] as const
  ).find(([hit]) => hit);

  if (direct) return direct[1];

  if (termCompact.length >= 4) {
    const allowed = termCompact.length >= 8 ? 2 : 1;

    if (
      [...words, keyCompact].some(
        (word) =>
          Math.abs(word.length - termCompact.length) <= allowed &&
          editDistance(termCompact, word) <= allowed,
      )
    )
      return 45;
  }

  if (termCompact.length >= 3) {
    const span = subsequenceSpan(termCompact, keyCompact);

    if (span !== undefined && span <= termCompact.length * 3)
      return Math.round(20 + 25 * (termCompact.length / span));
  }

  return 0;
}

/** Fuzzy-rank a repository: every query term must match some field. */
function searchMatch(
  repo: TrackedRepo,
  terms: readonly string[],
): TrackedRepoMatch | undefined {
  let total = 0;
  const matched = new Set<SearchField>();

  for (const term of terms) {
    let best = 0;
    let field: SearchField | undefined;

    for (const [name, weight, values] of SEARCH_FIELDS)
      for (const value of values(repo)) {
        const score = termScore(term, value) * weight;

        if (score > best) {
          best = score;
          field = name;
        }
      }

    if (!field || best < 15) return undefined;
    total += best;
    matched.add(field);
  }

  return {
    ...repo,
    score: Math.max(1, Math.round(total / terms.length)),
    matched: [...matched],
  };
}

function renderTable(repos: readonly TrackedRepo[]): string {
  const width = Math.max(...repos.map((repo) => repo.name.length));

  return repos
    .map((repo) => {
      const agents = repo.herdr?.agents.length ?? 0;

      const notes = [
        repo.github,
        repo.current ? "current" : null,
        repo.exists ? null : "missing",
        repo.herdr?.open ? "open in Herdr" : null,
        agents > 0 ? `${agents} agent${agents === 1 ? "" : "s"}` : null,
      ].filter((note) => note !== null);

      return `${repo.name.padEnd(width)}  ${repo.path}${notes.length ? `  (${notes.join(", ")})` : ""}`;
    })
    .join("\n");
}

/** Load tracked repositories and shortcuts from private `dot-git.yml`. */
const loadTracked = Effect.gen(function* () {
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

  return yield* Effect.forEach(entries, ([entry, github]) =>
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
        herdr: null,
      })),
    ),
  );
}).pipe(Effect.withSpan("repos.loadTracked"));

/** Attach live Herdr state and print JSON or a table; exit 1 when empty. */
const printRepos = Effect.fn("repos.print")(function* (
  selected: readonly TrackedRepo[],
  options: { readonly query?: string; readonly json: boolean },
) {
  const snapshot = selected.length > 0 ? yield* herdrSnapshot : undefined;

  const result = snapshot
    ? selected.map((repo) => ({ ...repo, herdr: repoHerdr(repo, snapshot) }))
    : selected;

  if (options.json || isAgent())
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (result.length > 0) process.stdout.write(`${renderTable(result)}\n`);

  if (options.query !== undefined && selected.length === 0) {
    process.stderr.write(`No tracked repository matches "${options.query}"\n`);
    process.exitCode = 1;
  }
});

/**
 * List tracked repositories and shortcuts from private `dot-git.yml` with
 * their live Herdr workspaces and agents, optionally filtered by a name,
 * alias, GitHub slug or path query. Prints JSON with `--json` or under an AI
 * agent, and exits 1 when a query matches nothing.
 */
export const repos = Effect.fn("repos")(function* (options: {
  readonly query?: string;
  readonly json: boolean;
}) {
  const tracked = yield* loadTracked;
  const query = options.query?.trim() || undefined;

  const selected = query
    ? tracked
        .flatMap((repo) => {
          const rank = matchRank(repo, query);

          return rank === undefined ? [] : [{ repo, rank }];
        })
        .sort((a, b) => a.rank - b.rank)
        .map(({ repo }) => repo)
    : tracked;

  yield* printRepos(selected, { query, json: options.json });
});

/**
 * Fuzzy-search tracked repositories by name, alias, GitHub repository name
 * and slug, directory and path. Every whitespace-separated term must match;
 * results are ranked by score with the fields that matched.
 */
export const searchRepos = Effect.fn("repos.search")(function* (options: {
  readonly query: string;
  readonly limit?: number;
  readonly json: boolean;
}) {
  const tracked = yield* loadTracked;
  const terms = options.query.toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0)
    return yield* new ReposError({ message: "Search query is empty" });

  const ranked = tracked
    .flatMap((repo) => {
      const match = searchMatch(repo, terms);

      return match ? [match] : [];
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, options.limit);

  yield* printRepos(ranked, { query: options.query, json: options.json });
});
