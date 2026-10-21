/**
 * @file Open pull requests over the GitHub REST API, for Claude Code cloud
 * sessions, whose GitHub proxy blocks the GraphQL search `dot pr list` uses
 * everywhere else.
 */
import { Api } from "@timmo001/effect-gh";
import { Effect, Result, Schema } from "effect";
import { viewerLogin, type GitHubService } from "./GitHub.js";
import type { RemotePullRequest } from "./GitPullRequests.js";
import { formatGhError } from "./record.js";
import type { RepositorySearch } from "./repositorySearch.js";

const RestPullRequest = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  html_url: Schema.String,
  draft: Schema.Boolean,
  updated_at: Schema.String,
  user: Schema.NullOr(
    Schema.Struct({ login: Schema.String, type: Schema.String }),
  ),
  assignees: Schema.NullOr(
    Schema.Array(Schema.Struct({ login: Schema.String })),
  ),
  head: Schema.Struct({ sha: Schema.String }),
});

const CheckRuns = Schema.Struct({
  check_runs: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.String,
      conclusion: Schema.NullOr(Schema.String),
      started_at: Schema.NullOr(Schema.String),
    }),
  ),
});

const CombinedStatus = Schema.Struct({
  statuses: Schema.Array(
    Schema.Struct({
      context: Schema.String,
      state: Schema.String,
      created_at: Schema.String,
    }),
  ),
});

type RestPullRequest = typeof RestPullRequest.Type;

/** Check runs and statuses of a head commit, shaped like a GraphQL rollup. */
const headChecks = Effect.fn("restPullRequests.headChecks")(function* (
  github: GitHubService,
  repo: string,
  sha: string,
) {
  const [runs, status] = yield* Effect.all(
    [
      github.read(
        "pull request check runs",
        Api.json(
          {
            endpoint: `repos/${repo}/commits/${sha}/check-runs`,
            method: "GET",
            query: { per_page: "100" },
          },
          CheckRuns,
        ),
      ),
      github.read(
        "pull request statuses",
        Api.json(
          { endpoint: `repos/${repo}/commits/${sha}/status`, method: "GET" },
          CombinedStatus,
        ),
      ),
    ],
    { concurrency: 2 },
  );

  return [
    ...runs.check_runs.map((run) => ({
      __typename: "CheckRun",
      name: run.name,
      status: run.status.toUpperCase(),
      conclusion: run.conclusion?.toUpperCase() ?? null,
      startedAt: run.started_at,
    })),
    ...status.statuses.map((context) => ({
      __typename: "StatusContext",
      context: context.context,
      state: context.state.toUpperCase(),
      createdAt: context.created_at,
    })),
  ];
});

/** A REST pull request as the GraphQL search node `dot pr list` caches. */
const toRemote = Effect.fn("restPullRequests.toRemote")(function* (
  github: GitHubService,
  repo: string,
  pull: RestPullRequest,
) {
  const remote: RemotePullRequest = {
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    isDraft: pull.draft,
    updatedAt: pull.updated_at,
    // GraphQL leaves the `[bot]` suffix off app logins; authorLogin adds it back.
    author:
      pull.user === null
        ? null
        : {
            __typename: pull.user.type === "Bot" ? "Bot" : "User",
            login: pull.user.login.replace(/\[bot\]$/, ""),
          },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: yield* headChecks(github, repo, pull.head.sha),
              },
            },
          },
        },
      ],
    },
  };

  return remote;
});

/**
 * Fetch the open pull requests of each repository over REST, mapping each to
 * its results or an error message, like `searchRepositories`. A cloud session
 * can only reach repositories attached to it, so callers pass only those.
 */
export const restOpenPullRequests = Effect.fn("restOpenPullRequests")(
  function* (
    github: GitHubService,
    repositories: readonly RepositorySearch[],
    failure: string,
  ) {
    const viewer = yield* Effect.cached(github.read("viewer", viewerLogin));

    const results = yield* Effect.forEach(
      repositories,
      (search) =>
        Effect.gen(function* () {
          const pulls = yield* github.read(
            "open pull requests",
            Api.json(
              {
                endpoint: `repos/${search.repo}/pulls`,
                method: "GET",
                query: {
                  state: "open",
                  sort: "updated",
                  direction: "desc",
                  per_page: "100",
                },
              },
              Schema.Array(RestPullRequest),
            ),
          );

          const login = search.mine ? yield* viewer : null;

          const selected =
            login === null
              ? pulls
              : pulls.filter(
                  (pull) =>
                    pull.user?.login === login ||
                    (pull.assignees ?? []).some(
                      (assignee) => assignee.login === login,
                    ),
                );

          return yield* Effect.forEach(
            selected,
            (pull) => toRemote(github, search.repo, pull),
            { concurrency: 4 },
          );
        }).pipe(
          Effect.timeout("45 seconds"),
          Effect.result,
          Effect.map(
            (result) =>
              [
                search.repo,
                Result.isFailure(result)
                  ? Result.fail(formatGhError(result.failure) || failure)
                  : Result.succeed(result.success),
              ] as const,
          ),
        ),
      { concurrency: 3 },
    );

    return new Map<string, Result.Result<RemotePullRequest[], string>>(results);
  },
);
