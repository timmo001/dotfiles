import { Schema } from "effect";
import {
  Login,
  ReviewThread,
  reviewThreadFields,
} from "./pullRequestReviews.js";

/** Cursor paging details of a GraphQL connection. */
export const PageInfo = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
});

/** A check run or commit status from a commit's status check rollup. */
export const CheckContext = Schema.Struct({
  __typename: Schema.String,
  name: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  conclusion: Schema.optionalKey(Schema.NullOr(Schema.String)),
  detailsUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  context: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(Schema.String),
  targetUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

/** Decoded {@link CheckContext}. */
export type CheckContext = typeof CheckContext.Type;

/** A pull request search result selected by {@link pullRequestFields}. */
export const PullRequestNode = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  body: Schema.optionalKey(Schema.String),
  url: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  isDraft: Schema.Boolean,
  additions: Schema.Int,
  deletions: Schema.Int,
  changedFiles: Schema.Int,
  reviewDecision: Schema.NullOr(Schema.String),
  authorAssociation: Schema.String,
  author: Login,
  repository: Schema.Struct({ nameWithOwner: Schema.String }),
  labels: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
  comments: Schema.Struct({
    totalCount: Schema.Int,
    nodes: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          body: Schema.String,
          url: Schema.String,
          createdAt: Schema.String,
          author: Login,
        }),
      ),
    ),
  }),
  reviewThreads: Schema.Struct({ nodes: Schema.Array(ReviewThread) }),
  latestReviews: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        author: Login,
        state: Schema.String,
        submittedAt: Schema.NullOr(Schema.String),
      }),
    ),
  }),
  commits: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        commit: Schema.Struct({
          statusCheckRollup: Schema.NullOr(
            Schema.Struct({
              contexts: Schema.Struct({ nodes: Schema.Array(CheckContext) }),
            }),
          ),
        }),
      }),
    ),
  }),
});

/** Decoded {@link PullRequestNode}. */
export type PullRequestNode = typeof PullRequestNode.Type;

/**
 * GraphQL selection for a `PullRequest` matching {@link PullRequestNode}. The
 * query must declare a `$bodies: Boolean!` variable gating comment bodies.
 */
export const pullRequestFields = `number title body @include(if: $bodies) url createdAt updatedAt isDraft additions deletions changedFiles reviewDecision authorAssociation
author { login }
repository { nameWithOwner }
labels(first: 30) { nodes { name } }
comments(last: 10) {
  totalCount
  nodes @include(if: $bodies) { body url createdAt author { login } }
}
reviewThreads(first: 100) {
  nodes { ${reviewThreadFields({ comments: 20, bodies: "$bodies" })} }
}
latestReviews(first: 20) { nodes { author { login } state submittedAt } }
commits(last: 1) {
  nodes {
    commit {
      statusCheckRollup {
        contexts(first: 100) {
          nodes {
            __typename
            ... on CheckRun { name status conclusion detailsUrl }
            ... on StatusContext { context state targetUrl }
          }
        }
      }
    }
  }
}`;

/** Response schema of a paged `search` returning `node` results. */
export const searchResponse = <S extends Schema.Top>(node: S) =>
  Schema.Struct({
    data: Schema.Struct({
      search: Schema.Struct({
        issueCount: Schema.Int,
        pageInfo: PageInfo,
        nodes: Schema.Array(node),
      }),
    }),
  });

const FAILED_RUNS = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE"]);

const FAILED_STATUSES = new Set(["FAILURE", "ERROR"]);

/** Check contexts of a pull request's head commit. */
export const checkContexts = (node: PullRequestNode) =>
  node.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];

/** Display name of a check run or status. */
export const checkName = (context: CheckContext) =>
  context.name ?? context.context ?? context.__typename;

/** Web page of a check run or status, when GitHub reports one. */
export const checkUrl = (context: CheckContext) =>
  context.detailsUrl ?? context.targetUrl ?? undefined;

/** Whether a check run or status failed. */
export const isFailedCheck = (context: CheckContext) =>
  context.__typename === "CheckRun"
    ? FAILED_RUNS.has(context.conclusion ?? "")
    : FAILED_STATUSES.has(context.state ?? "");

/** Whether a check run or status is still running or expected. */
export const isPendingCheck = (context: CheckContext) =>
  context.__typename === "CheckRun"
    ? context.status !== "COMPLETED"
    : context.state === "PENDING" || context.state === "EXPECTED";
