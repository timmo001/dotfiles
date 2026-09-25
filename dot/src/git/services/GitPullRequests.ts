import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  Clock,
  Context,
  Effect,
  Layer,
  Result,
  Schedule,
  Schema,
} from "effect";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { managedGitRepos } from "../../services/GitConfig.js";
import { formatCause } from "../../lib/schema.js";
import { GitHub } from "./GitHub.js";
import { formatGhError } from "./record.js";

const REFRESH_MS = 5 * 60 * 1000;

const PullRequest = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  author: Schema.String,
  draft: Schema.Boolean,
  seen: Schema.Boolean,
  notified: Schema.Boolean,
});

const PullRequestState = Schema.Struct({
  checkedAt: Schema.NullOr(Schema.Finite),
  attemptedAt: Schema.NullOr(Schema.Finite),
  error: Schema.NullOr(Schema.String),
  deliveryError: Schema.NullOr(Schema.String),
  pulls: Schema.Array(PullRequest),
});

const RemotePullRequest = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  html_url: Schema.String,
  user: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  draft: Schema.Boolean,
});

/** Failure to load or persist tracked pull requests. */
export class PullRequestsError extends Schema.TaggedError<PullRequestsError>()(
  "PullRequestsError",
  {
    message: Schema.String,
  },
) {}

/** Cached open PRs with repository identity from current private configuration. */
export interface PullRequestRepository {
  /** GitHub owner/repo slug. */
  readonly repo: string;
  /** Friendly repository name. */
  readonly name: string;
  /** Local checkout used to resolve browser preferences. */
  readonly path: string;
  /** Open PRs, most recently updated first. */
  readonly pulls: readonly (typeof PullRequest.Type)[];
  /** Last successful fetch, or null before the first successful check. */
  readonly checkedAt: number | null;
  /** Fetch or storage error; previous PRs remain available. */
  readonly error: string | null;
  /** Desktop delivery failure, separate from fetch errors. */
  readonly deliveryError: string | null;
}

/** Query and local acknowledgement options for tracked PRs. */
export interface PullRequestQuery {
  /** Select an enabled repository by name or GitHub slug. */
  readonly repo?: string;
  /** Fetch immediately instead of using the five-minute cache. */
  readonly refresh?: boolean;
  /** Deliver grouped desktop alerts for previously unannounced PRs. */
  readonly notify?: boolean;
  /** Mark this PR as seen locally without fetching or changing GitHub notifications. */
  readonly seen?: number;
}

/** Cached PR queries and acknowledgements for the CLI and Git panel. */
interface GitPullRequestsService {
  /** Return all selected enabled repositories, retaining cached PRs on fetch failure. */
  readonly query: (
    options: PullRequestQuery,
  ) => Effect.Effect<readonly PullRequestRepository[], PullRequestsError>;
}

const emptyState = (): typeof PullRequestState.Type => ({
  checkedAt: null,
  attemptedAt: null,
  error: null,
  deliveryError: null,
  pulls: [],
});

/** Effect service for {@link GitPullRequestsService}. */
export class GitPullRequests extends Context.Service<
  GitPullRequests,
  GitPullRequestsService
>()("GitPullRequests") {
  static readonly layer = Layer.effect(
    GitPullRequests,
    Effect.gen(function* () {
      const config = yield* Config;
      const github = yield* GitHub;
      const executor = yield* CommandExecutor;

      const query = Effect.fn("GitPullRequests.query")(function* (
        options: PullRequestQuery,
      ) {
        if (!config.gitConfig.valid)
          return yield* new PullRequestsError({
            message: config.gitConfig.diagnostics.join("\n"),
          });

        const repositories = managedGitRepos(config.gitConfig).filter(
          (repo) =>
            repo.pullRequests?.enabled &&
            (!options.repo ||
              [repo.name, repo.github].some(
                (name) => name.toLowerCase() === options.repo?.toLowerCase(),
              )),
        );

        if (
          (options.repo && repositories.length !== 1) ||
          (options.seen !== undefined && !options.repo)
        )
          return yield* new PullRequestsError({
            message: "Select one enabled pull request repository with --repo",
          });

        return yield* Effect.forEach(
          repositories,
          (repo) =>
            Effect.gen(function* () {
              const directory = join(
                config.stateDir,
                "git-pull-requests",
                encodeURIComponent(repo.github.toLowerCase()),
              );

              const file = join(directory, "state.json");

              const io = <A>(operation: () => A) =>
                Effect.try({
                  try: operation,
                  catch: (error) =>
                    new PullRequestsError({ message: formatCause(error) }),
                });

              // An inherited descriptor keeps the kernel lock held until this scope closes.
              const descriptor = yield* Effect.acquireRelease(
                io(() => {
                  mkdirSync(directory, { recursive: true, mode: 0o700 });

                  return openSync(join(directory, "write.lock"), "a+", 0o600);
                }),
                (fd) => Effect.sync(() => closeSync(fd)),
              );

              const acquired = yield* io(() => {
                const result = Bun.spawnSync(
                  ["flock", "--exclusive", "--nonblock", "0"],
                  {
                    stdin: descriptor,
                    stdout: "ignore",
                    stderr: "pipe",
                  },
                );

                if (result.exitCode === 0) return true;

                if (result.exitCode === 1) return false;
                throw new Error(
                  result.stderr.toString().trim() ||
                    "Could not lock pull request state",
                );
              }).pipe(
                Effect.repeat({
                  while: (locked) => !locked,
                  times: 239,
                  schedule: Schedule.spaced("250 millis"),
                }),
              );

              if (!acquired)
                return yield* new PullRequestsError({
                  message: "Pull request state is busy; retry shortly",
                });

              let state = yield* io(() =>
                existsSync(file)
                  ? Schema.decodeUnknownSync(PullRequestState)(
                      JSON.parse(readFileSync(file, "utf8")),
                    )
                  : emptyState(),
              );

              const now = yield* Clock.currentTimeMillis;
              let changed = false;

              if (options.seen !== undefined) {
                state = {
                  ...state,
                  pulls: state.pulls.map((pr) =>
                    pr.number === options.seen
                      ? { ...pr, seen: true, notified: true }
                      : pr,
                  ),
                };
                changed = true;
              } else if (
                options.refresh ||
                state.attemptedAt === null ||
                now < state.attemptedAt ||
                now - state.attemptedAt >= REFRESH_MS
              ) {
                const result = yield* github
                  .json([
                    "api",
                    "--method",
                    "GET",
                    `repos/${repo.github}/pulls?state=open&sort=updated&direction=desc&per_page=100`,
                    "--paginate",
                    "--slurp",
                  ])
                  .pipe(
                    Effect.flatMap(
                      Schema.decodeUnknownEffect(
                        Schema.Array(Schema.Array(RemotePullRequest)),
                      ),
                    ),
                    Effect.timeout("45 seconds"),
                    Effect.result,
                  );

                if (Result.isFailure(result))
                  state = {
                    ...state,
                    attemptedAt: now,
                    error:
                      formatGhError(result.failure) ||
                      "Could not fetch open pull requests",
                  };
                else {
                  const previous = new Map(
                    state.pulls.map((pr) => [pr.number, pr]),
                  );

                  const unique = new Map(
                    result.success.flat().map((pr) => [pr.number, pr]),
                  );

                  state = {
                    ...state,
                    checkedAt: now,
                    attemptedAt: now,
                    error: null,
                    pulls: Array.from(unique.values(), (pr) => ({
                      number: pr.number,
                      title: pr.title,
                      url: pr.html_url,
                      author: pr.user?.login ?? "Deleted user",
                      draft: pr.draft,
                      seen: previous.get(pr.number)?.seen ?? false,
                      notified: previous.get(pr.number)?.notified ?? false,
                    })),
                  };
                }

                changed = true;
              }

              if (
                options.notify &&
                state.error === null &&
                options.seen === undefined
              ) {
                const pending = state.pulls.filter(
                  (pr) => !pr.notified && !pr.seen,
                );

                if (pending.length) {
                  const sent = yield* executor
                    .run("omarchy", [
                      "notification",
                      "send",
                      "--app-name",
                      "Git pull requests",
                      "--urgency",
                      "normal",
                      `${repo.name}: ${pending.length} new pull request${pending.length === 1 ? "" : "s"}`,
                      pending
                        .map((pr) => `#${pr.number} ${pr.title}`)
                        .join("\n")
                        .slice(0, 400),
                      "--exec",
                      "dot",
                      "git-pull-requests",
                      "--open",
                      "--repo",
                      repo.github,
                    ])
                    .pipe(Effect.timeout("15 seconds"), Effect.result);

                  state = Result.isFailure(sent)
                    ? {
                        ...state,
                        deliveryError: `Notification delivery failed: ${formatGhError(sent.failure) || "Could not send notification"}`,
                      }
                    : {
                        ...state,
                        deliveryError: null,
                        pulls: state.pulls.map((pr) => ({
                          ...pr,
                          notified: true,
                        })),
                      };
                  changed = true;
                }
              }

              if (changed)
                yield* io(() => {
                  const temporary = join(directory, `.${randomUUID()}.tmp`);

                  try {
                    writeFileSync(temporary, JSON.stringify(state), {
                      mode: 0o600,
                      flag: "wx",
                    });
                    renameSync(temporary, file);
                  } finally {
                    if (existsSync(temporary)) unlinkSync(temporary);
                  }
                });

              return {
                repo: repo.github,
                name: repo.name,
                path: repo.path,
                pulls: state.pulls,
                checkedAt: state.checkedAt,
                error: state.error,
                deliveryError: state.deliveryError,
              };
            }).pipe(
              Effect.scoped,
              Effect.catch((error) =>
                Effect.succeed({
                  repo: repo.github,
                  name: repo.name,
                  path: repo.path,
                  pulls: [],
                  checkedAt: null,
                  error: error.message,
                  deliveryError: null,
                }),
              ),
            ),
          { concurrency: 4 },
        );
      });

      return { query };
    }),
  );
}
