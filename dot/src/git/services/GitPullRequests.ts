import { NodeServices } from "@effect/platform-node";
import { join } from "node:path";
import { writeFileAtomic } from "../../lib/atomicWrite.js";
import { acquireFileLock } from "../../lib/fileLock.js";
import {
  Array as Arr,
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
  type GitManagedRepo,
} from "../../services/GitConfig.js";
import { graphql } from "../../lib/pullRequestReviews.js";
import {
  CheckContext,
  checkName,
  isFailedCheck,
  isPendingCheck,
} from "../../lib/pullRequestSearch.js";
import { formatCause } from "../../lib/schema.js";
import { GitHub } from "./GitHub.js";
import { formatGhError } from "./record.js";

const REFRESH_MS = 5 * 60 * 1000;

// Repositories searched per GraphQL request; each needs one or two aliases.
const SEARCH_BATCH = 10;

const CheckStatus = Schema.Literals([
  "pass",
  "fail",
  "pending",
  "cancelled",
  "none",
  "unknown",
]);

const TrackedPullRequest = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  author: Schema.String,
  draft: Schema.Boolean,
  // Older snapshots have no check data; treat them as unknown until refreshed.
  checks: Schema.optionalKey(CheckStatus),
  failingChecks: Schema.optionalKey(Schema.Array(Schema.String)),
});

const PullRequestState = Schema.Struct({
  checkedAt: Schema.NullOr(Schema.Finite),
  attemptedAt: Schema.NullOr(Schema.Finite),
  error: Schema.NullOr(Schema.String),
  pulls: Schema.Array(TrackedPullRequest),
  ignored: Schema.optionalKey(Schema.Array(Schema.Int)),
});

const RollupContext = Schema.Struct({
  ...CheckContext.fields,
  startedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  createdAt: Schema.optionalKey(Schema.String),
  checkSuite: Schema.optionalKey(
    Schema.Struct({
      workflowRun: Schema.NullOr(
        Schema.Struct({ workflow: Schema.Struct({ name: Schema.String }) }),
      ),
    }),
  ),
});

type RollupContext = typeof RollupContext.Type;

const RemotePullRequest = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  isDraft: Schema.Boolean,
  updatedAt: Schema.String,
  author: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  commits: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        commit: Schema.Struct({
          statusCheckRollup: Schema.NullOr(
            Schema.Struct({
              contexts: Schema.Struct({ nodes: Schema.Array(RollupContext) }),
            }),
          ),
        }),
      }),
    ),
  }),
});

type RemotePullRequest = typeof RemotePullRequest.Type;

const SearchResponse = Schema.Struct({
  data: Schema.Record(
    Schema.String,
    Schema.Struct({ nodes: Schema.Array(RemotePullRequest) }),
  ),
});

const PULL_REQUEST_FIELDS = `... on PullRequest {
  number title url isDraft updatedAt
  author { login }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { name status conclusion startedAt checkSuite { workflowRun { workflow { name } } } }
              ... on StatusContext { context state createdAt }
            }
          }
        }
      }
    }
  }
}`;

const searchQuery = (count: number) => {
  const indexes = Arr.makeBy(count, (index) => index);

  return `query(${indexes.map((index) => `$q${index}: String!`).join(", ")}) {
${indexes.map((index) => `s${index}: search(type: ISSUE, query: $q${index}, first: 100) { nodes { ${PULL_REQUEST_FIELDS} } }`).join("\n")}
}`;
};

// Re-runs leave superseded contexts in the rollup; keep the latest per check, as gh pr checks does.
const latestChecks = (contexts: readonly RollupContext[]) => {
  const latest = new Map<string, RollupContext>();

  for (const context of contexts) {
    const key = `${context.checkSuite?.workflowRun?.workflow.name ?? ""}\0${context.name ?? context.context ?? ""}`;
    const previous = latest.get(key);

    if (
      !previous ||
      (context.startedAt ?? context.createdAt ?? "") >
        (previous.startedAt ?? previous.createdAt ?? "")
    )
      latest.set(key, context);
  }

  return [...latest.values()];
};

const checkStatus = (
  contexts: readonly RollupContext[],
): typeof CheckStatus.Type => {
  if (contexts.some(isFailedCheck)) return "fail";

  if (contexts.some(isPendingCheck)) return "pending";

  if (contexts.some((context) => context.conclusion === "CANCELLED"))
    return "cancelled";

  if (
    contexts.some((context) =>
      ["SUCCESS", "NEUTRAL"].includes(
        context.conclusion ?? context.state ?? "",
      ),
    )
  )
    return "pass";

  return "none";
};

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
  readonly pulls: readonly (typeof TrackedPullRequest.Type & {
    readonly checks: typeof CheckStatus.Type;
    readonly failingChecks: readonly string[];
  })[];
  /** Last successful fetch, or null before the first successful check. */
  readonly checkedAt: number | null;
  /** Fetch or storage error; previous PRs remain available. */
  readonly error: string | null;
}

/** Query options for tracked PRs. */
export interface PullRequestQuery {
  /** Select an enabled repository by name or GitHub slug. */
  readonly repo?: string;
  /** Fetch immediately instead of using the five-minute cache. */
  readonly refresh?: boolean;
  /** Hide a PR locally in the selected repository until it closes or disappears. */
  readonly ignore?: number;
}

/** Cached PR queries for the CLI and Git panel. */
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
      const fs = yield* FileSystem.FileSystem;

      const stateDirectory = (repo: GitManagedRepo) =>
        join(
          config.stateDir,
          "git-pull-requests",
          encodeURIComponent(repo.github.toLowerCase()),
        );

      const io = <A>(operation: () => A) =>
        Effect.try({
          try: operation,
          catch: (error) =>
            new PullRequestsError({ message: formatCause(error) }),
        });

      const readState = (file: string) =>
        fs.exists(file).pipe(
          Effect.flatMap((exists) =>
            exists
              ? fs
                  .readFileString(file)
                  .pipe(
                    Effect.flatMap((text) =>
                      io(() =>
                        Schema.decodeUnknownSync(PullRequestState)(
                          JSON.parse(text),
                        ),
                      ),
                    ),
                  )
              : Effect.succeed(emptyState()),
          ),
          Effect.mapError((error) =>
            error instanceof PullRequestsError
              ? error
              : new PullRequestsError({ message: formatCause(error) }),
          ),
        );

      // One GraphQL search per repository (two for the `mine` scope), batched into few requests.
      const fetchOpen = Effect.fn("GitPullRequests.fetchOpen")(function* (
        repositories: readonly GitManagedRepo[],
      ) {
        const batches = yield* Effect.forEach(
          Arr.chunksOf(repositories, SEARCH_BATCH),
          (batch) => {
            const searches = batch.flatMap((repo, index) =>
              (repo.pullRequests?.scope === "mine"
                ? ["author:@me", "assignee:@me"]
                : [""]
              ).map((filter) => ({
                index,
                query: `repo:${repo.github} is:pr is:open ${filter} sort:updated-desc`,
              })),
            );

            return github
              .read(
                "pull request search",
                graphql(
                  searchQuery(searches.length),
                  Object.fromEntries(
                    searches.map((search, index) => [
                      `q${index}`,
                      search.query,
                    ]),
                  ),
                  SearchResponse,
                ),
                { checkRateLimit: false },
              )
              .pipe(
                Effect.timeout("45 seconds"),
                Effect.result,
                Effect.map((result) =>
                  batch.map((repo, index) => {
                    if (Result.isFailure(result))
                      return [
                        repo.github,
                        Result.fail(
                          formatGhError(result.failure) ||
                            "Could not fetch open pull requests",
                        ),
                      ] as const;

                    return [
                      repo.github,
                      Result.succeed(
                        searches.flatMap((search, alias) =>
                          search.index === index
                            ? (result.success.data[`s${alias}`]?.nodes ?? [])
                            : [],
                        ),
                      ),
                    ] as const;
                  }),
                ),
              );
          },
          { concurrency: 3 },
        );

        return new Map<string, Result.Result<RemotePullRequest[], string>>(
          batches.flat(),
        );
      });

      const query = Effect.fn("GitPullRequests.query")(function* (
        options: PullRequestQuery,
      ) {
        if (!config.gitConfig.valid)
          return yield* new PullRequestsError({
            message: config.gitConfig.diagnostics.join("\n"),
          });

        if (
          options.ignore !== undefined &&
          (!options.repo ||
            !Number.isSafeInteger(options.ignore) ||
            options.ignore <= 0)
        )
          return yield* new PullRequestsError({
            message:
              "Ignoring a pull request requires --repo and a positive PR number",
          });

        const repositories = managedGitRepos(config.gitConfig).filter(
          (repo) =>
            repo.pullRequests?.enabled &&
            (!options.repo ||
              [repo.name, repo.github].some(
                (name) => name.toLowerCase() === options.repo?.toLowerCase(),
              )),
        );

        if (options.repo && repositories.length !== 1)
          return yield* new PullRequestsError({
            message: "Select one enabled pull request repository with --repo",
          });

        const now = yield* Clock.currentTimeMillis;

        const due =
          options.ignore !== undefined
            ? []
            : yield* Effect.filter(repositories, (repo) =>
                readState(join(stateDirectory(repo), "state.json")).pipe(
                  Effect.map(
                    (state) =>
                      options.refresh === true ||
                      state.attemptedAt === null ||
                      now < state.attemptedAt ||
                      now - state.attemptedAt >= REFRESH_MS,
                  ),
                  Effect.orElseSucceed(() => true),
                ),
              );

        const fetched = due.length
          ? yield* fetchOpen(due)
          : new Map<string, Result.Result<RemotePullRequest[], string>>();

        return yield* Effect.forEach(
          repositories,
          (repo) =>
            Effect.gen(function* () {
              const directory = stateDirectory(repo);
              const file = join(directory, "state.json");

              yield* acquireFileLock(join(directory, "write.lock"), {
                wait: "1 minute",
              }).pipe(
                Effect.provide(NodeServices.layer),
                Effect.mapError(
                  (error) =>
                    new PullRequestsError({
                      message:
                        error.reason === "busy"
                          ? "Pull request state is busy; retry shortly"
                          : `Could not lock pull request state: ${error.message}`,
                    }),
                ),
              );

              let state = yield* readState(file);
              const result = fetched.get(repo.github);
              let changed = false;

              if (options.ignore !== undefined) {
                if (
                  !state.pulls.some((pr) => pr.number === options.ignore) &&
                  !state.ignored?.includes(options.ignore)
                )
                  return yield* new PullRequestsError({
                    message:
                      "Pull request is no longer listed; refresh the panel",
                  });

                state = {
                  ...state,
                  ignored: [
                    ...new Set([...(state.ignored ?? []), options.ignore]),
                  ],
                };
                changed = true;
              } else if (result && Result.isFailure(result)) {
                state = { ...state, attemptedAt: now, error: result.failure };
                changed = true;
              } else if (result) {
                const unique = new Map(
                  result.success
                    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                    .map((pr) => [pr.number, pr]),
                );

                const ignored = (state.ignored ?? []).filter((number) =>
                  unique.has(number),
                );

                state = {
                  ...state,
                  checkedAt: now,
                  attemptedAt: now,
                  error: null,
                  ignored,
                  pulls: unique
                    .values()
                    .filter((pr) => !ignored.includes(pr.number))
                    .map((pr) => {
                      const checks = latestChecks(
                        pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts
                          .nodes ?? [],
                      );

                      return {
                        number: pr.number,
                        title: pr.title,
                        url: pr.url,
                        author: pr.author?.login ?? "Deleted user",
                        draft: pr.isDraft,
                        checks: checkStatus(checks),
                        failingChecks: [
                          ...new Set(
                            checks.flatMap((check) =>
                              isFailedCheck(check) ? [checkName(check)] : [],
                            ),
                          ),
                        ],
                      };
                    })
                    .toArray(),
                };
                changed = true;
              }

              if (changed)
                yield* io(() =>
                  writeFileAtomic(file, JSON.stringify(state), { mode: 0o600 }),
                );

              return {
                repo: repo.github,
                name: repo.name,
                path: repo.path,
                pulls: state.pulls
                  .filter((pr) => !state.ignored?.includes(pr.number))
                  .map((pr) => ({
                    ...pr,
                    checks: pr.checks ?? "unknown",
                    failingChecks: pr.failingChecks ?? [],
                  })),
                checkedAt: state.checkedAt,
                error: state.error,
              };
            }).pipe(
              Effect.scoped,
              Effect.catch((error) =>
                options.ignore !== undefined
                  ? Effect.fail(error)
                  : Effect.succeed({
                      repo: repo.github,
                      name: repo.name,
                      path: repo.path,
                      pulls: [],
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
