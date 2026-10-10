import { NodeServices } from "@effect/platform-node";
import { join } from "node:path";
import { writeFileAtomic } from "../../lib/atomicWrite.js";
import { acquireFileLock } from "../../lib/fileLock.js";
import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Result,
  Schema,
} from "effect";
import { Config } from "../../services/Config.js";
import {
  managedGitRepos,
  type IssueExclusion,
} from "../../services/GitConfig.js";
import { formatCause } from "../../lib/schema.js";
import { Api } from "@timmo001/effect-gh";
import { GitHub, viewerLogin } from "./GitHub.js";
import { formatGhError } from "./record.js";

const REFRESH_MS = 5 * 60 * 1000;

const TrackedIssue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  author: Schema.String,
  labels: Schema.Array(Schema.String),
  comments: Schema.Int,
});

const IssueState = Schema.Struct({
  checkedAt: Schema.NullOr(Schema.Finite),
  attemptedAt: Schema.NullOr(Schema.Finite),
  error: Schema.NullOr(Schema.String),
  issues: Schema.Array(TrackedIssue),
});

const RemoteIssue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  html_url: Schema.String,
  user: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  labels: Schema.Array(Schema.Struct({ name: Schema.String })),
  comments: Schema.Int,
  updated_at: Schema.String,
  // The issues API also lists pull requests; they carry this key.
  pull_request: Schema.optionalKey(Schema.Unknown),
});

/** Failure to load or persist tracked issues. */
export class IssuesError extends Schema.TaggedError<IssuesError>()(
  "IssuesError",
  {
    message: Schema.String,
  },
) {}

/** Cached open issues with repository identity from current private configuration. */
export interface IssueRepository {
  /** GitHub owner/repo slug. */
  readonly repo: string;
  /** Friendly repository name. */
  readonly name: string;
  /** Local checkout used to resolve browser preferences and agent sessions. */
  readonly path: string;
  /** Open issues, most recently updated first. */
  readonly issues: readonly (typeof TrackedIssue.Type)[];
  /** Last successful fetch, or null before the first successful check. */
  readonly checkedAt: number | null;
  /** Fetch or storage error; previous issues remain available. */
  readonly error: string | null;
}

/** Query options for tracked issues. */
export interface IssueQuery {
  /** Select an enabled repository by name or GitHub slug. */
  readonly repo?: string;
  /** Fetch immediately instead of using the five-minute cache. */
  readonly refresh?: boolean;
}

/** Cached issue queries for the CLI and Git panel. */
interface GitIssuesService {
  /** Return all selected enabled repositories, retaining cached issues on fetch failure. */
  readonly query: (
    options: IssueQuery,
  ) => Effect.Effect<readonly IssueRepository[], IssuesError>;
}

const emptyState = (): typeof IssueState.Type => ({
  checkedAt: null,
  attemptedAt: null,
  error: null,
  issues: [],
});

const same = (expected: string | undefined, actual: string) =>
  expected === undefined || expected.toLowerCase() === actual.toLowerCase();

const issueExcluded = (
  rule: IssueExclusion,
  repo: string,
  issue: typeof TrackedIssue.Type,
) =>
  same(rule.repo, repo) &&
  same(rule.title, issue.title) &&
  same(rule.author, issue.author) &&
  (rule.label === undefined ||
    issue.labels.some((label) => same(rule.label, label)));

/** Effect service for {@link GitIssuesService}. */
export class GitIssues extends Context.Service<GitIssues, GitIssuesService>()(
  "GitIssues",
) {
  static readonly layer = Layer.effect(
    GitIssues,
    Effect.gen(function* () {
      const config = yield* Config;
      const github = yield* GitHub;
      const fs = yield* FileSystem.FileSystem;

      const query = Effect.fn("GitIssues.query")(function* (
        options: IssueQuery,
      ) {
        if (!config.gitConfig.valid)
          return yield* new IssuesError({
            message: config.gitConfig.diagnostics.join("\n"),
          });

        const repositories = managedGitRepos(config.gitConfig).filter(
          (repo) =>
            repo.issues?.enabled &&
            (!options.repo ||
              [repo.name, repo.github].some(
                (name) => name.toLowerCase() === options.repo?.toLowerCase(),
              )),
        );

        if (options.repo && repositories.length !== 1)
          return yield* new IssuesError({
            message: "Select one enabled issue repository with --repo",
          });

        const exclusions = config.gitConfig.issueExclusions;

        const login = yield* Effect.cached(github.read("user", viewerLogin));

        return yield* Effect.forEach(
          repositories,
          (repo) =>
            Effect.gen(function* () {
              const directory = join(
                config.stateDir,
                "git-issues",
                encodeURIComponent(repo.github.toLowerCase()),
              );

              const file = join(directory, "state.json");

              const io = <A>(operation: () => A) =>
                Effect.try({
                  try: operation,
                  catch: (error) =>
                    new IssuesError({ message: formatCause(error) }),
                });

              yield* acquireFileLock(join(directory, "write.lock"), {
                wait: "1 minute",
              }).pipe(
                Effect.provide(NodeServices.layer),
                Effect.mapError(
                  (error) =>
                    new IssuesError({
                      message:
                        error.reason === "busy"
                          ? "Issue state is busy; retry shortly"
                          : `Could not lock issue state: ${error.message}`,
                    }),
                ),
              );

              let state = yield* fs.exists(file).pipe(
                Effect.flatMap((exists) =>
                  exists
                    ? fs
                        .readFileString(file)
                        .pipe(
                          Effect.flatMap((text) =>
                            io(() =>
                              Schema.decodeUnknownSync(IssueState)(
                                JSON.parse(text),
                              ),
                            ),
                          ),
                        )
                    : Effect.succeed(emptyState()),
                ),
                Effect.mapError((error) =>
                  error instanceof IssuesError
                    ? error
                    : new IssuesError({ message: formatCause(error) }),
                ),
              );

              const now = yield* Clock.currentTimeMillis;

              if (
                options.refresh ||
                state.attemptedAt === null ||
                now < state.attemptedAt ||
                now - state.attemptedAt >= REFRESH_MS
              ) {
                const endpoint = `repos/${repo.github}/issues?state=open&sort=updated&direction=desc&per_page=100`;

                const result = yield* (
                  repo.issues?.scope === "mine"
                    ? login.pipe(
                        Effect.map((user) =>
                          ["creator", "assignee"].map(
                            (filter) => `${endpoint}&${filter}=${user}`,
                          ),
                        ),
                      )
                    : Effect.succeed([endpoint])
                ).pipe(
                  Effect.flatMap((endpoints) =>
                    Effect.forEach(endpoints, (url) =>
                      github.read(
                        url,
                        Api.pages(
                          { endpoint: url, method: "GET" },
                          Schema.Array(RemoteIssue),
                        ),
                      ),
                    ),
                  ),
                  Effect.map((pages) =>
                    pages
                      .flat(2)
                      .toSorted((a, b) =>
                        b.updated_at.localeCompare(a.updated_at),
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
                      "Could not fetch open issues",
                  };
                else {
                  const unique = new Map(
                    result.success
                      .filter((issue) => issue.pull_request === undefined)
                      .map((issue) => [issue.number, issue]),
                  );

                  state = {
                    checkedAt: now,
                    attemptedAt: now,
                    error: null,
                    issues: [...unique.values()].map((issue) => ({
                      number: issue.number,
                      title: issue.title,
                      url: issue.html_url,
                      author: issue.user?.login ?? "Deleted user",
                      labels: issue.labels.map((label) => label.name),
                      comments: issue.comments,
                    })),
                  };
                }

                yield* io(() =>
                  writeFileAtomic(file, JSON.stringify(state), { mode: 0o600 }),
                );
              }

              return {
                repo: repo.github,
                name: repo.name,
                path: repo.path,
                issues: state.issues.filter(
                  (issue) =>
                    !exclusions.some((rule) =>
                      issueExcluded(rule, repo.github, issue),
                    ),
                ),
                checkedAt: state.checkedAt,
                error: state.error,
              };
            }).pipe(
              Effect.scoped,
              Effect.catch((error) =>
                Effect.succeed({
                  repo: repo.github,
                  name: repo.name,
                  path: repo.path,
                  issues: [],
                  checkedAt: null,
                  error: error.message,
                }),
              ),
            ),
          { concurrency: 4 },
        );
      });

      return { query };
    }),
  ).pipe(Layer.provide(NodeServices.layer));
}
