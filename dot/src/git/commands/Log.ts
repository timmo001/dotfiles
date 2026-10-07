import { join } from "node:path";
import { Effect, FileSystem, Option, Result, Schema } from "effect";
import { writeFileAtomic } from "../../lib/atomicWrite.js";
import { readFileChanges, type FileChange } from "../../lib/updateSummary.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import { managedGitRepos } from "../../services/GitConfig.js";
import { formatCommandError, handleCommandError } from "./rows.js";

const COMMIT_LIMIT = 40;

const LogCommit = Schema.Struct({
  sha: Schema.String,
  author: Schema.String,
  date: Schema.String,
  subject: Schema.String,
  incoming: Schema.Boolean,
});

const LogEntry = Schema.Struct({
  head: Schema.String,
  upstream: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  commits: Schema.Array(LogCommit),
});

const LogState = Schema.Record(Schema.String, LogEntry);

class GitLogError extends Schema.TaggedError<GitLogError>()("GitLogError", {
  message: Schema.String,
}) {}

/** Recent commits for one managed repository. */
export interface GitLogRepository {
  /** Friendly repository name. */
  readonly name: string;
  /** Local checkout path. */
  readonly path: string;
  /** GitHub owner/repo slug. */
  readonly repo: string;
  /** Checked-out branch, or null when detached. */
  readonly branch: string | null;
  /** Newest first, including fetched upstream commits not yet pulled. */
  readonly commits: readonly (typeof LogCommit.Type)[];
  /** Read failure; cached commits remain available. */
  readonly error: string | null;
}

/** Return recent commits for every managed checkout, re-reading only repositories whose refs moved. */
export const queryGitLog = Effect.fn("gitLog.query")(function* (
  refresh: boolean,
) {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const file = join(config.stateDir, "git-log", "state.json");

  const cached: typeof LogState.Type = yield* fs.readFileString(file).pipe(
    Effect.flatMap((text) => Effect.try(() => JSON.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(LogState)),
    Effect.orElseSucceed(() => ({})),
  );

  const git = (path: string, args: readonly string[]) =>
    executor
      .run("git", args, { cwd: path })
      .pipe(Effect.map((out) => out.trim()));

  const optionalGit = (path: string, args: readonly string[]) =>
    git(path, args).pipe(
      Effect.option,
      Effect.map((value) => Option.getOrNull(value) || null),
    );

  const readEntry = Effect.fn("gitLog.readEntry")(function* (path: string) {
    const head = yield* git(path, ["rev-parse", "HEAD"]);

    const upstream = yield* optionalGit(path, [
      "rev-parse",
      "--verify",
      "--quiet",
      "@{u}",
    ]);

    const branch = yield* optionalGit(path, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "HEAD",
    ]);

    const previous = cached[path];

    if (!refresh && previous?.head === head && previous.upstream === upstream)
      return previous;

    const incoming = upstream
      ? new Set(
          (yield* git(path, [
            "rev-list",
            `-n${COMMIT_LIMIT}`,
            `${head}..${upstream}`,
          ]))
            .split("\n")
            .filter(Boolean),
        )
      : new Set<string>();

    const output = yield* git(path, [
      "log",
      `-n${COMMIT_LIMIT}`,
      "--format=%H%x1f%an%x1f%cI%x1f%s%x1e",
      head,
      ...(upstream ? [upstream] : []),
    ]);

    const commits = output
      .split("\x1e")
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [sha = "", author = "", date = "", subject = ""] =
          record.split("\x1f");

        return { sha, author, date, subject, incoming: incoming.has(sha) };
      });

    return { head, upstream, branch, commits };
  });

  const next: Record<string, typeof LogEntry.Type> = {};

  const repositories = yield* Effect.forEach(
    managedGitRepos(config.gitConfig),
    (repo) =>
      Effect.gen(function* () {
        if (
          !(yield* fs.exists(repo.path).pipe(Effect.orElseSucceed(() => false)))
        )
          return null;

        const result = yield* readEntry(repo.path).pipe(Effect.result);

        const entry = Result.isSuccess(result)
          ? result.success
          : cached[repo.path];

        if (entry) next[repo.path] = entry;

        return {
          name: repo.name,
          path: repo.path,
          repo: repo.github,
          branch: entry?.branch ?? null,
          commits: entry?.commits ?? [],
          error: Result.isFailure(result)
            ? formatCommandError(result.failure)
            : null,
        } satisfies GitLogRepository;
      }),
    { concurrency: 8 },
  );

  if (JSON.stringify(next) !== JSON.stringify(cached))
    yield* Effect.try(() =>
      writeFileAtomic(file, JSON.stringify(next), {
        mode: 0o600,
        createDirectory: true,
      }),
    ).pipe(Effect.ignore);

  return repositories.filter((repo) => repo !== null);
});

/** Print recent commits as text, or as JSON for the Git panel. */
export const gitLog = Effect.fn("gitLog.print")(function* (
  refresh: boolean,
  panelJson: boolean,
) {
  const repositories = yield* queryGitLog(refresh);

  const text = panelJson
    ? JSON.stringify({ repositories }) + "\n"
    : repositories
        .map((repo) =>
          [
            `${repo.name}${repo.branch ? ` (${repo.branch})` : ""}`,
            ...(repo.error ? [`  ${repo.error}`] : []),
            ...repo.commits.map(
              (commit) =>
                `  ${commit.sha.slice(0, 7)}${commit.incoming ? " ↓" : ""} ${commit.subject}`,
            ),
          ].join("\n"),
        )
        .join("\n\n") + "\n";

  // The CLI exits explicitly, so wait until the whole snapshot is flushed.
  yield* writeOutput(text);
}, handleCommandError("dot git-log"));

/** Most patch lines returned in a commit's diff preview. */
const PREVIEW_LINES = 120;

/** Widest patch line kept in a commit's diff preview. */
const PREVIEW_LINE_WIDTH = 240;

const writeOutput = (text: string) =>
  Effect.promise(
    () =>
      new Promise<void>((resolve) =>
        process.stdout.write(text, () => resolve()),
      ),
  );

/** Local changes `dot git-log show` can preview instead of a commit. */
export type LogShowChanges = "uncommitted" | "unpushed";

/**
 * Print changed files and a diff preview as JSON for the Git panel: one
 * commit (merges are compared with their first parent), the uncommitted
 * working tree including untracked files, or the commits not pushed upstream.
 */
export const gitLogShow = Effect.fn("gitLog.show")(function* (
  path: string,
  sha: string | undefined,
  changes: LogShowChanges | undefined,
) {
  const config = yield* Config;
  const executor = yield* CommandExecutor;

  if ((sha === undefined) === (changes === undefined))
    return yield* new GitLogError({
      message: "Pass exactly one of --sha or --changes",
    });

  if (sha !== undefined && !/^[0-9a-f]{7,64}$/.test(sha))
    return yield* new GitLogError({ message: `Invalid commit: ${sha}` });

  if (!managedGitRepos(config.gitConfig).some((repo) => repo.path === path))
    return yield* new GitLogError({
      message: `Not a managed repository: ${path}`,
    });

  const [command, revision] =
    sha !== undefined
      ? [["show", "--format=", "--diff-merges=first-parent"], sha]
      : [["diff"], changes === "unpushed" ? "@{u}...HEAD" : "HEAD"];

  const tracked = yield* readFileChanges(path, command, [revision]);

  const untracked =
    changes === "uncommitted"
      ? (yield* executor.run(
          "git",
          ["ls-files", "--others", "--exclude-standard"],
          { cwd: path },
        ))
          .split("\n")
          .filter((file) => file.length > 0)
          .map((file): FileChange => ({
            status: "?",
            path: file,
            added: null,
            deleted: null,
          }))
      : [];

  const files = [...tracked, ...untracked];

  const patch = (yield* executor.run(
    "git",
    [
      ...command,
      "--patch",
      "--no-color",
      "--no-renames",
      "--default-prefix",
      revision,
    ],
    { cwd: path },
  ))
    .replace(/\n$/, "")
    .split("\n");

  const preview = patch
    .slice(0, PREVIEW_LINES)
    .map((line) =>
      line.length > PREVIEW_LINE_WIDTH
        ? `${line.slice(0, PREVIEW_LINE_WIDTH)}…`
        : line,
    )
    .join("\n");

  yield* writeOutput(
    JSON.stringify({
      target: sha ?? changes,
      files,
      added: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
      deleted: files.reduce((sum, file) => sum + (file.deleted ?? 0), 0),
      preview,
      truncated: patch.length > PREVIEW_LINES,
    }) + "\n",
  );
}, handleCommandError("dot git-log show"));
