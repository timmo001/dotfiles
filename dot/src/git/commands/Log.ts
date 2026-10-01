import { join } from "node:path";
import { Effect, FileSystem, Option, Result, Schema } from "effect";
import { writeFileAtomic } from "../../lib/atomicWrite.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import { managedGitRepos } from "../../services/GitConfig.js";
import { formatCommandError, handleCommandError } from "./rows.js";

const COMMIT_LIMIT = 20;

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
  yield* Effect.promise(
    () =>
      new Promise<void>((resolve) =>
        process.stdout.write(text, () => resolve()),
      ),
  );
}, handleCommandError("dot git-log"));
