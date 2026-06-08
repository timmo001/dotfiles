import { Clock, Context, Effect, Layer, PubSub, Stream } from "effect";
import type { GitLogCommit, GitLogRepo, GitLogState } from "../../types.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { DotDiff } from "./DotDiff.js";
import { ENV, envString } from "../../lib/env.js";

const COMMIT_SEPARATOR = String.fromCharCode(31);
const DEFAULT_LIMIT = 20;
const DEBUG = !!envString(ENV.DOT_DEBUG);
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:GitLog] ${msg}`);
};

/** Service interface for recent commit history across tracked repositories. */
interface GitLogService {
  /** Subscribe to git log state snapshots. */
  readonly subscribe: () => Stream.Stream<GitLogState>;
  /** Refresh recent commit history for all tracked repositories. */
  readonly refresh: () => Effect.Effect<void>;
  /** Return the most recent git log state. */
  readonly getState: () => Effect.Effect<GitLogState>;
}

/** Effect service for {@link GitLogService}. */
export class GitLog extends Context.Service<GitLog, GitLogService>()("GitLog") {
  static readonly layer = Layer.effect(
    GitLog,
    Effect.gen(function* () {
      log("Initialising GitLog...");
      const dotDiff = yield* DotDiff;
      const executor = yield* CommandExecutor;
      const pubsub = yield* PubSub.unbounded<GitLogState>();

      let currentState = buildState(
        [],
        new Date(yield* Clock.currentTimeMillis),
        false,
        false,
      );

      const loadRepo = Effect.fn("GitLog.loadRepo")(function* (repo: {
        readonly name: string;
        readonly path: string;
      }) {
        return yield* executor
          .run("git", gitLogArgs(DEFAULT_LIMIT), { cwd: repo.path })
          .pipe(
            Effect.map((output) => {
              const commits = parseGitLog(output);
              return {
                name: repo.name,
                path: repo.path,
                latestAt: latestCommitTime(commits),
                commits,
              } satisfies GitLogRepo;
            }),
            Effect.catch((error) =>
              Effect.succeed({
                name: repo.name,
                path: repo.path,
                latestAt: null,
                commits: [],
                error: formatError(error),
              } satisfies GitLogRepo),
            ),
          );
      });

      const refresh = Effect.gen(function* () {
        log("Refreshing git log...");
        currentState = buildState(
          currentState.repos,
          new Date(yield* Clock.currentTimeMillis),
          true,
          currentState.loaded,
        );
        yield* PubSub.publish(pubsub, currentState);

        const trackedRepos = yield* dotDiff.listAll();
        if (trackedRepos.length === 0) {
          currentState = buildState(
            [],
            new Date(yield* Clock.currentTimeMillis),
            false,
            true,
            "No tracked repositories found",
          );
          yield* PubSub.publish(pubsub, currentState);
          return;
        }

        const repos = yield* Effect.all(trackedRepos.map(loadRepo), {
          concurrency: 4,
        });
        currentState = buildState(
          sortRepos(repos),
          new Date(yield* Clock.currentTimeMillis),
          false,
          true,
        );
        yield* PubSub.publish(pubsub, currentState);
        log(`Refresh complete: ${repos.length} repositories`);
      }).pipe(
        Effect.withSpan("GitLog.refresh"),
        Effect.catch((error) =>
          Effect.gen(function* () {
            currentState = buildState(
              currentState.repos,
              new Date(yield* Clock.currentTimeMillis),
              false,
              currentState.loaded,
              formatError(error),
            );
            yield* PubSub.publish(pubsub, currentState);
          }),
        ),
      );

      return {
        subscribe: () => Stream.fromPubSub(pubsub),
        refresh: () => refresh,
        getState: () => Effect.succeed(currentState),
      };
    }),
  );
}

function gitLogArgs(limit: number): readonly string[] {
  return [
    "log",
    `--max-count=${limit}`,
    "--date=iso-strict",
    "--pretty=format:%H%x1f%h%x1f%cI%x1f%an%x1f%s",
  ];
}

function parseGitLog(output: string): readonly GitLogCommit[] {
  return output
    .split("\n")
    .map(parseGitLogLine)
    .filter((commit): commit is GitLogCommit => commit !== null);
}

function parseGitLogLine(line: string): GitLogCommit | null {
  const [
    rawSha = "",
    rawShortSha = "",
    rawCommittedAt = "",
    rawAuthorName = "",
    ...rawSubject
  ] = line.split(COMMIT_SEPARATOR);
  const sha = rawSha.trim();
  if (sha.length === 0) return null;

  return {
    sha,
    shortSha: trimmedOr(rawShortSha, sha.slice(0, 7)),
    committedAt: trimmedOrNull(rawCommittedAt),
    authorName: trimmedOr(rawAuthorName, "unknown"),
    subject: trimmedOr(rawSubject.join(COMMIT_SEPARATOR), "(no subject)"),
  };
}

function trimmedOr(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function latestCommitTime(commits: readonly GitLogCommit[]): string | null {
  return commits[0]?.committedAt ?? null;
}

function sortRepos(repos: readonly GitLogRepo[]): readonly GitLogRepo[] {
  return [...repos].sort((a, b) => {
    const byTime = timestamp(b.latestAt) - timestamp(a.latestAt);
    return byTime !== 0 ? byTime : a.name.localeCompare(b.name);
  });
}

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function buildState(
  repos: readonly GitLogRepo[],
  lastChecked: Date,
  loading: boolean,
  loaded: boolean,
  message?: string,
): GitLogState {
  return {
    repos,
    lastChecked,
    loading,
    loaded,
    ...(message && { message }),
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
