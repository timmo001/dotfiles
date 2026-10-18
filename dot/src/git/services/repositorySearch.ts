import { Array as Arr, Effect, Result, Schema } from "effect";
import { graphql } from "../../lib/pullRequestReviews.js";
import type { GitHubService } from "./GitHub.js";
import { formatGhError } from "./record.js";

// Repositories searched per GraphQL request; each needs one or two aliases.
const SEARCH_BATCH = 10;

/** Author of a search result; select it with `author { __typename login }`. */
export const SearchAuthor = Schema.Struct({
  __typename: Schema.String,
  login: Schema.String,
});

/** REST-style login, with the `[bot]` suffix GraphQL leaves off app authors. */
export const authorLogin = (author: typeof SearchAuthor.Type | null) =>
  author === null
    ? "Deleted user"
    : author.__typename === "Bot"
      ? `${author.login}[bot]`
      : author.login;

/** Open items to search for in one repository. */
export interface RepositorySearch {
  /** GitHub owner/repo slug. */
  readonly repo: string;
  /** Only list items the viewer created or is assigned. */
  readonly mine: boolean;
}

/** Options for {@link searchRepositories}. */
export interface RepositorySearchOptions<S extends Schema.Top> {
  /** Search qualifiers, such as `is:pr is:open`. */
  readonly qualifiers: string;
  /** GraphQL selection applied to each search result node. */
  readonly fields: string;
  /** Schema of each search result node. */
  readonly node: S;
  /** Error stored when a failure has no message. */
  readonly failure: string;
}

/**
 * Run one GitHub search per repository (two for `mine`), batched into a few
 * GraphQL requests. Each repository maps to its results, or an error message
 * when its batch failed. Results stop at 100 per search.
 */
export const searchRepositories = Effect.fn("searchRepositories")(function* <
  S extends Schema.Top,
>(
  github: GitHubService,
  repositories: readonly RepositorySearch[],
  options: RepositorySearchOptions<S>,
) {
  const response = Schema.Struct({
    data: Schema.Record(
      Schema.String,
      Schema.Struct({ nodes: Schema.Array(options.node) }),
    ),
  });

  const batches = yield* Effect.forEach(
    Arr.chunksOf(repositories, SEARCH_BATCH),
    (batch) => {
      const searches = batch.flatMap((repo, index) =>
        (repo.mine ? ["author:@me", "assignee:@me"] : [""]).map((filter) => ({
          index,
          query: `repo:${repo.repo} ${options.qualifiers} ${filter} sort:updated-desc`,
        })),
      );

      const aliases = searches.map((_, alias) => alias);

      return github
        .read(
          "repository search",
          graphql(
            `query(${aliases.map((alias) => `$q${alias}: String!`).join(", ")}) {
${aliases.map((alias) => `s${alias}: search(type: ISSUE, query: $q${alias}, first: 100) { nodes { ${options.fields} } }`).join("\n")}
}`,
            Object.fromEntries(
              searches.map((search, alias) => [`q${alias}`, search.query]),
            ),
            response,
          ),
          { checkRateLimit: false },
        )
        .pipe(
          Effect.timeout("45 seconds"),
          Effect.result,
          Effect.map((result) =>
            batch.map(
              (repo, index) =>
                [
                  repo.repo,
                  Result.isFailure(result)
                    ? Result.fail(
                        formatGhError(result.failure) || options.failure,
                      )
                    : Result.succeed(
                        searches.flatMap((search, alias) =>
                          search.index === index
                            ? (result.success.data[`s${alias}`]?.nodes ?? [])
                            : [],
                        ),
                      ),
                ] as const,
            ),
          ),
        );
    },
    { concurrency: 3 },
  );

  return new Map<string, Result.Result<S["Type"][], string>>(batches.flat());
});
