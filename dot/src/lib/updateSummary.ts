import { Effect, FileSystem } from "effect";
import { OutputLog, formatCliLine } from "../services/OutputLog.js";
import { cliStyler } from "./ansi.js";
import { gitOutput } from "./git.js";
import { completedIn, plural } from "./runSummary.js";
import type { CommandExecutor } from "../services/CommandExecutor.js";
import type { LogLevel } from "../services/OutputLog.js";
import type { Styler } from "./ansi.js";

/** Most commits listed per repository before the rest are counted. */
const MAX_COMMITS = 15;

/** Most changed files listed per repository before the rest are counted. */
const MAX_FILES = 50;

/** Widest file path column before paths stop being padded. */
const MAX_PATH_COLUMN = 60;

/** A repository moved by `dot update`, with the revisions to compare. */
export interface UpdatedRepo {
  /** Repository display name. */
  readonly name: string;
  /** Repository checkout path. */
  readonly path: string;
  /** Revision before the pull, or `ORIG_HEAD` when pulled before a restart. */
  readonly from: string;
  /** Revision after the pull, or `HEAD` when pulled before a restart. */
  readonly to: string;
}

/** A mise tool version, including any backend prefix such as `npm:`. */
interface MiseToolVersion {
  /** mise tool name. */
  readonly tool: string;
  /** Installed or pruned version. */
  readonly version: string;
}

/** A mise tool version changed by `dot update` for the global mise config. */
export type MiseToolChange =
  | (MiseToolVersion & { readonly change: "installed" | "removed" })
  | (MiseToolVersion & {
      readonly change: "updated";
      /** Newest version installed before the update. */
      readonly previous: string;
    });

/** One stage outcome in the `dot update` recap. */
export interface RecapEntry {
  /** Whether the stage did work, was skipped, or needs attention. */
  readonly status: "done" | "skip" | "warn";
  /** Sentence-case description of the outcome. */
  readonly message: string;
  /** Whether the work is out of the ordinary for a run, shown in bold. */
  readonly notable?: boolean;
}

/** A recap entry for a stage that did routine work. */
export const done = (message: string): RecapEntry => ({
  status: "done",
  message,
});

/** A recap entry for a stage that did work most runs do not, such as pulling changes. */
export const notable = (message: string): RecapEntry => ({
  status: "done",
  message,
  notable: true,
});

/** A recap entry's message: bold when the work was notable, dimmed when routine. */
export const recapMessage = (entry: RecapEntry, style: Styler): string =>
  entry.notable ? style.label(entry.message) : style.dim(entry.message);

/** A recap entry for a stage that was skipped. */
export const skip = (message: string): RecapEntry => ({
  status: "skip",
  message,
});

/** A recap entry for a stage that needs attention. */
export const warn = (message: string): RecapEntry => ({
  status: "warn",
  message,
});

const renderRecapEntry = (
  entry: RecapEntry,
  style: Styler,
  line: SummaryLine,
) => {
  switch (entry.status) {
    case "done":
      return line("success", recapMessage(entry, style));
    case "skip":
      return line("info", `${style.dim("○")} ${style.dim(entry.message)}`);
    case "warn":
      return line("warn", entry.message);
  }
};

interface Commit {
  readonly sha: string;
  readonly subject: string;
}

/** One changed file with its status letter and line counts. */
export interface FileChange {
  /** `git --name-status` letter, such as `A`, `M` or `D`. */
  readonly status: string;
  /** Repository-relative path. */
  readonly path: string;
  /** Added lines, or null for binary files. */
  readonly added: number | null;
  /** Deleted lines, or null for binary files. */
  readonly deleted: number | null;
}

interface RepoChanges {
  readonly from: string;
  readonly to: string;
  readonly commits: readonly Commit[];
  readonly files: readonly FileChange[];
}

const lines = (output: string): string[] =>
  output.split("\n").filter((line) => line.trim() !== "");

const parseCount = (value: string | undefined): number | null =>
  value === undefined || value === "-" ? null : Number(value);

/**
 * Read changed files with their status and line counts. `command` is the git
 * subcommand and its options (such as `["diff"]` or `["show", "--format="]`),
 * and `revisions` the revisions to compare.
 */
export const readFileChanges = (
  cwd: string,
  command: readonly string[],
  revisions: readonly string[],
) =>
  Effect.gen(function* () {
    const git = (format: string) =>
      gitOutput([...command, format, "--no-renames", ...revisions], { cwd });

    const counts = new Map(
      lines(yield* git("--numstat")).map((line) => {
        const [added, deleted, ...path] = line.split("\t");

        return [
          path.join("\t"),
          { added: parseCount(added), deleted: parseCount(deleted) },
        ] as const;
      }),
    );

    return lines(yield* git("--name-status")).map((line): FileChange => {
      const [status = "?", ...rest] = line.split("\t");
      const path = rest.join("\t");
      const count = counts.get(path);

      return {
        status,
        path,
        added: count?.added ?? null,
        deleted: count?.deleted ?? null,
      };
    });
  });

const readChanges = (repo: UpdatedRepo) =>
  Effect.gen(function* () {
    const git = (args: readonly string[]) =>
      gitOutput(args, { cwd: repo.path });

    const short = (rev: string) =>
      git(["rev-parse", "--short", rev]).pipe(Effect.map((sha) => sha.trim()));

    const from = yield* short(repo.from);
    const to = yield* short(repo.to);

    const commits = lines(
      yield* git([
        "log",
        "--no-decorate",
        "--format=%h%x09%s",
        `${repo.from}..${repo.to}`,
      ]),
    ).map((line): Commit => {
      const [sha = "", ...subject] = line.split("\t");

      return { sha, subject: subject.join("\t") };
    });

    const files = yield* readFileChanges(
      repo.path,
      ["diff"],
      [repo.from, repo.to],
    );

    return { from, to, commits, files } satisfies RepoChanges;
  });

const statusColour = (style: Styler, status: string): string => {
  const label = status.padEnd(2);

  switch (status) {
    case "A":
      return style.success(label);
    case "D":
      return style.error(label);
    case "M":
      return style.warn(label);
    default:
      return style.accent(label);
  }
};

const lineCounts = (style: Styler, file: FileChange): string => {
  if (file.added === null || file.deleted === null) return style.dim("binary");

  return [
    file.added > 0 ? style.success(`+${file.added}`) : "",
    file.deleted > 0 ? style.error(`-${file.deleted}`) : "",
  ]
    .filter(Boolean)
    .join(" ");
};

/** Matches a Conventional Commits prefix such as `fix(dot)!: `. */
const CONVENTIONAL_PREFIX = /^(\w+)(\([^)]*\))?(!)?: /;

/** Colour a commit subject's Conventional Commits type, scope, and break marker. */
const commitSubject = (style: Styler, subject: string): string => {
  const match = CONVENTIONAL_PREFIX.exec(subject);

  if (!match) return subject;
  const [prefix, type = "", scope = "", breaking = ""] = match;

  return `${style.accent(type)}${style.dim(scope)}${style.error(breaking)}${style.dim(":")} ${subject.slice(prefix.length)}`;
};

const repoHeading = (
  style: Styler,
  name: string,
  changes: RepoChanges,
): string => {
  const added = changes.files.reduce((sum, file) => sum + (file.added ?? 0), 0);

  const deleted = changes.files.reduce(
    (sum, file) => sum + (file.deleted ?? 0),
    0,
  );

  const stats = [
    plural(changes.commits.length, "commit"),
    plural(changes.files.length, "file"),
    `${style.success(`+${added}`)} ${style.error(`-${deleted}`)}`,
  ].join(style.dim(" · "));

  return `${style.label(style.accent(name))}  ${style.dim(`${changes.from} -> ${changes.to}`)}  ${stats}`;
};

/** Receives one summary line at its log level. */
type SummaryLine = (
  level: Exclude<LogLevel, "error">,
  message: string,
) => Effect.Effect<void>;

const renderRepoChanges = (
  repo: UpdatedRepo,
  style: Styler,
  line: SummaryLine,
) =>
  Effect.gen(function* () {
    const changes = yield* readChanges(repo).pipe(
      Effect.orElseSucceed(() => null),
    );

    if (!changes) {
      yield* line("info", style.label(style.accent(repo.name)));
      yield* line("warn", `Could not read changes for ${repo.name}`);

      return;
    }

    yield* line("info", repoHeading(style, repo.name, changes));

    if (changes.commits.length > 0) {
      yield* line("info", `  ${style.label("Commits")}`);

      for (const commit of changes.commits.slice(0, MAX_COMMITS)) {
        yield* line(
          "info",
          `    ${style.warn(commit.sha)} ${commitSubject(style, commit.subject)}`,
        );
      }

      if (changes.commits.length > MAX_COMMITS) {
        yield* line(
          "info",
          `    ${style.dim(`...and ${changes.commits.length - MAX_COMMITS} more`)}`,
        );
      }
    }

    if (changes.files.length > 0) {
      yield* line("info", `  ${style.label("Files changed")}`);

      const shown = changes.files.slice(0, MAX_FILES);

      const width = Math.min(
        MAX_PATH_COLUMN,
        Math.max(...shown.map((file) => file.path.length)),
      );

      for (const file of shown) {
        yield* line(
          "info",
          `    ${statusColour(style, file.status)} ${file.path.padEnd(width)}  ${lineCounts(style, file)}`,
        );
      }

      if (changes.files.length > MAX_FILES) {
        yield* line(
          "info",
          `    ${style.dim(`...and ${changes.files.length - MAX_FILES} more`)}`,
        );
      }
    }
  });

/** Merge repeated pulls of one repository into a single range. */
const mergeUpdatedRepos = (
  repos: readonly UpdatedRepo[],
): readonly UpdatedRepo[] => {
  const merged = new Map<string, UpdatedRepo>();

  for (const repo of repos) {
    const existing = merged.get(repo.path);
    merged.set(repo.path, existing ? { ...existing, to: repo.to } : repo);
  }

  return [...merged.values()];
};

const miseToolLine = (
  style: Styler,
  tool: MiseToolChange,
  width: number,
): string => {
  const name = style.accent(tool.tool.padEnd(width));

  switch (tool.change) {
    case "installed":
      return `${style.success("I")}  ${name}  ${style.success(tool.version)}`;
    case "updated":
      return `${style.warn("U")}  ${name}  ${style.warn(tool.previous)} ${style.dim("->")} ${style.success(tool.version)}`;
    case "removed":
      return `${style.error("R")}  ${name}  ${tool.version}`;
  }
};

const renderMiseTools = (
  tools: readonly MiseToolChange[],
  style: Styler,
  line: SummaryLine,
) =>
  Effect.gen(function* () {
    if (tools.length === 0) return;

    yield* line("info", "");
    yield* line("info", style.label(`Mise tools (${tools.length})`));

    const width = Math.max(...tools.map(({ tool }) => tool.length));

    for (const tool of tools) {
      yield* line("info", `  ${miseToolLine(style, tool, width)}`);
    }
  });

const renderUpdateSummary = (
  updated: readonly UpdatedRepo[],
  miseTools: readonly MiseToolChange[],
  actions: readonly RecapEntry[],
  startedAt: number,
  line: SummaryLine,
) =>
  Effect.gen(function* () {
    const style = cliStyler();
    const repos = mergeUpdatedRepos(updated);

    yield* line("section", "Summary");

    if (repos.length > 0) {
      yield* line(
        "info",
        style.label(`Updated repositories (${repos.length})`),
      );

      for (const repo of repos) {
        yield* line("info", "");
        yield* renderRepoChanges(repo, style, line);
      }
    }

    yield* renderMiseTools(miseTools, style, line);

    yield* line("info", "");
    yield* line("info", style.label("Recap"));

    for (const entry of actions) {
      yield* renderRecapEntry(entry, style, line);
    }

    yield* line("info", "");
    yield* line("info", yield* completedIn(startedAt));
  });

/** Log the commits and changed files pulled into each updated repository. */
export function logRepoChanges(
  updated: readonly UpdatedRepo[],
): Effect.Effect<void, never, OutputLog | CommandExecutor> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const style = cliStyler();

    for (const repo of mergeUpdatedRepos(updated)) {
      yield* log.info("");
      yield* renderRepoChanges(repo, style, (level, message) =>
        log[level](message),
      );
    }
  });
}

/**
 * Log the repositories updated, mise tool changes, and workflow actions
 * completed by `dot update`, with the commits and changed files pulled into
 * each repository, and the time elapsed since `startedAt` (epoch ms).
 */
export function logUpdateSummary(
  updated: readonly UpdatedRepo[],
  miseTools: readonly MiseToolChange[],
  actions: readonly RecapEntry[],
  startedAt: number,
): Effect.Effect<void, never, OutputLog | CommandExecutor> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;

    yield* renderUpdateSummary(
      updated,
      miseTools,
      actions,
      startedAt,
      (level, message) => log[level](message),
    );
  });
}

/**
 * Write the {@link logUpdateSummary} output to `path` as terminal-formatted
 * text, so a parent command can print it after its later steps.
 */
export function writeUpdateSummary(
  path: string,
  updated: readonly UpdatedRepo[],
  miseTools: readonly MiseToolChange[],
  actions: readonly RecapEntry[],
  startedAt: number,
): Effect.Effect<void, never, CommandExecutor | FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const output: string[] = [];

    yield* renderUpdateSummary(
      updated,
      miseTools,
      actions,
      startedAt,
      (level, message) =>
        Effect.sync(() => output.push(formatCliLine(level, message))),
    );

    yield* fs
      .writeFileString(path, output.join("\n") + "\n")
      .pipe(Effect.orDie);
  });
}
