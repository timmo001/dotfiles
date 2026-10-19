import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { decide, type WorkersAi } from "../lib/decisionModel.js";
import {
  Login,
  authorLogin,
  ghErrorMessage,
  graphql,
} from "../lib/pullRequestReviews.js";
import { searchResponse } from "../lib/pullRequestSearch.js";
import { OutputLog } from "../services/OutputLog.js";
import type { GithubSection } from "./config.js";
import type { GithubItem, GithubResult } from "./result.js";

/** A GitHub search for a report section failed. */
export class ReportGithubError extends Schema.TaggedError<ReportGithubError>()(
  "ReportGithubError",
  { message: Schema.String },
) {}

const PAGE_SIZE = 50;

const DEFAULT_LIMIT = 100;

const BODY_LIMIT = 2000;

const SearchNode = Schema.Struct({
  __typename: Schema.String,
  number: Schema.optionalKey(Schema.Int),
  title: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(Schema.String),
  isDraft: Schema.optionalKey(Schema.Boolean),
  additions: Schema.optionalKey(Schema.Int),
  deletions: Schema.optionalKey(Schema.Int),
  updatedAt: Schema.optionalKey(Schema.String),
  mergedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  author: Schema.optionalKey(Login),
  repository: Schema.optionalKey(
    Schema.Struct({ nameWithOwner: Schema.String }),
  ),
  files: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        nodes: Schema.Array(Schema.Struct({ path: Schema.String })),
      }),
    ),
  ),
});

const SearchResponse = searchResponse(SearchNode);

const shared =
  "number title body url state updatedAt author { login } repository { nameWithOwner }";

const query = (
  withFiles: boolean,
) => `query($q: String!, $first: Int!, $cursor: String) {
  search(query: $q, type: ISSUE, first: $first, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on PullRequest { ${shared} isDraft additions deletions mergedAt${withFiles ? " files(first: 100) { nodes { path } }" : ""} }
      ... on Issue { ${shared} }
    }
  }
}`;

const Relevance = Schema.Struct({
  topic: Schema.Struct({
    probabilities: Schema.Struct({ relevant: Schema.Finite }),
  }),
});

const OTHER = "a feature, fix, layout or any other change";

/** Date as `YYYY-MM-DD` for GitHub search qualifiers. */
const day = (iso: string) => iso.slice(0, 10);

/**
 * Run a section's GitHub search, with `{since}` set to `since`. With `decide`,
 * the decision model sorts each result into `about` or `other` and drops those
 * whose `about` probability is below `min`; a result it can't judge is kept.
 */
export const runGithubSection = Effect.fn("report.github")(function* (
  section: GithubSection,
  options: {
    readonly since: string;
    readonly decisionModel: string | undefined;
    readonly workersAi: WorkersAi | undefined;
  },
) {
  const output = yield* OutputLog;
  const limit = section.limit ?? DEFAULT_LIMIT;
  const q = section.query.replaceAll("{since}", day(options.since));
  const nodes: (typeof SearchNode.Type)[] = [];
  let cursor: string | null = null;

  do {
    const response: typeof SearchResponse.Type = yield* graphql(
      query(section.files_for !== undefined),
      { q, first: Math.min(PAGE_SIZE, limit - nodes.length), cursor },
      SearchResponse,
    ).pipe(
      Effect.mapError(
        (error) =>
          new ReportGithubError({
            message: `${section.id}: GitHub search failed: ${ghErrorMessage(error)}`,
          }),
      ),
    );

    nodes.push(...response.data.search.nodes);
    cursor = response.data.search.pageInfo.hasNextPage
      ? response.data.search.pageInfo.endCursor
      : null;
  } while (cursor !== null && nodes.length < limit);

  const found = nodes.flatMap((node): GithubItem[] =>
    node.number !== undefined && node.title !== undefined && node.url
      ? [
          {
            kind: node.__typename === "PullRequest" ? "pr" : "issue",
            number: node.number,
            title: node.title,
            url: node.url,
            repository: node.repository?.nameWithOwner ?? "",
            author: authorLogin(node.author ?? null),
            state: node.state ?? "",
            draft: node.isDraft ?? false,
            additions: node.additions,
            deletions: node.deletions,
            updatedAt: node.updatedAt ?? "",
            mergedAt: node.mergedAt ?? undefined,
            files: node.files?.nodes.map((file) => file.path) ?? [],
            relevance: undefined,
          },
        ]
      : [],
  );

  const filter = section.decide;
  const model = options.decisionModel;

  if (!filter || !model)
    return {
      type: "github",
      section,
      items: found,
      dropped: 0,
    } satisfies GithubResult;

  const bodies = new Map(
    nodes.map((node) => [node.number, node.body?.slice(0, BODY_LIMIT) ?? ""]),
  );

  const judged = yield* Effect.forEach(
    found,
    (item) =>
      decide({
        model,
        // A two-way choice separates relevant results far better than a yes/no statement.
        questions: {
          topic: {
            type: "choice",
            instructions: "What is `item` mainly about?",
            criteria: { relevant: filter.about, other: filter.other ?? OTHER },
          },
        },
        state: {
          item: {
            kind: item.kind,
            title: item.title,
            body: bodies.get(item.number) ?? "",
          },
        },
        workersAi: options.workersAi,
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Relevance)),
        Effect.map((answers): GithubItem => ({
          ...item,
          relevance: answers.topic.probabilities.relevant,
        })),
        Effect.catch((error) =>
          output
            .warn(
              `Kept #${item.number} without a relevance check: ${error.message}`,
            )
            .pipe(Effect.as(item)),
        ),
      ),
    { concurrency: 4 },
  );

  const min = filter.min ?? 0.5;

  const items = judged.filter(
    (item) => item.relevance === undefined || item.relevance >= min,
  );

  return {
    type: "github",
    section,
    items,
    dropped: judged.length - items.length,
  } satisfies GithubResult;
}, Effect.provide(FetchHttpClient.layer));
