import { Api, type GhError } from "@timmo001/effect-gh";
import { Effect, Match, Schema } from "effect";
import { formatCause } from "./schema.js";

/** gh options shared by pull request commands. */
export const GH_OPTIONS = { timeout: "2 minutes" } as const;

/** A GitHub actor that may be missing when the account was deleted. */
export const Login = Schema.NullOr(Schema.Struct({ login: Schema.String }));

/** Login for display, with GitHub's `ghost` placeholder for deleted accounts. */
export const authorLogin = (login: typeof Login.Type) =>
  login?.login ?? "ghost";

/** Minimization fields shared by reviews and review comments. */
export const Minimized = {
  isMinimized: Schema.Boolean,
  minimizedReason: Schema.NullOr(Schema.String),
};

/** One review thread comment; `body` is omitted when the query skips bodies. */
export const ReviewComment = Schema.Struct({
  id: Schema.String,
  body: Schema.optionalKey(Schema.String),
  createdAt: Schema.String,
  url: Schema.String,
  author: Login,
  pullRequestReview: Schema.NullOr(Schema.Struct({ id: Schema.String })),
  ...Minimized,
});

/** Decoded {@link ReviewComment}. */
export type ReviewComment = typeof ReviewComment.Type;

/** A pull request review thread selected by {@link reviewThreadFields}. */
export const ReviewThread = Schema.Struct({
  id: Schema.String,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  path: Schema.String,
  line: Schema.NullOr(Schema.Int),
  originalLine: Schema.NullOr(Schema.Int),
  resolvedBy: Login,
  comments: Schema.Struct({
    totalCount: Schema.Int,
    nodes: Schema.Array(ReviewComment),
  }),
});

/** Decoded {@link ReviewThread}. */
export type ReviewThread = typeof ReviewThread.Type;

/**
 * GraphQL selection for a review thread node matching {@link ReviewThread}.
 * `bodies` names a Boolean variable that gates comment bodies, keeping
 * many-pull-request queries small; omit it to always select bodies.
 */
export const reviewThreadFields = (options: {
  readonly comments: number;
  readonly bodies?: `$${string}`;
}) =>
  `id isResolved isOutdated path line originalLine
  resolvedBy { login }
  comments(first: ${options.comments}) {
    totalCount
    nodes {
      id ${options.bodies ? `body @include(if: ${options.bodies})` : "body"} createdAt url isMinimized minimizedReason
      author { login }
      pullRequestReview { id }
    }
  }`;

/** Why a thread no longer needs attention, or `undefined` while it is open. */
export function threadStatus(thread: ReviewThread): string | undefined {
  const [first] = thread.comments.nodes;

  if (first?.isMinimized)
    return `minimized as ${first.minimizedReason ?? "unknown"}`;

  if (thread.isResolved) return `resolved by ${authorLogin(thread.resolvedBy)}`;
}

/** Whether a thread is neither resolved nor minimized. */
export const isOpenThread = (thread: ReviewThread) =>
  threadStatus(thread) === undefined;

/** Thread location as `path:line`, preferring the current line. */
export const threadLocation = (thread: ReviewThread) =>
  `${thread.path}:${thread.line ?? thread.originalLine ?? "?"}${thread.isOutdated ? " (outdated)" : ""}`;

/** Markdown block quote of a comment body. */
export const quote = (body: string) =>
  body
    .trim()
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");

/** One-line description of a gh failure. */
export const ghErrorMessage = (error: GhError) =>
  Match.valueTags(error, {
    GhCommandError: (error) => error.stderr.trim(),
    GhTimeoutError: (error) => `gh timed out after ${error.timeoutMs}ms`,
    GhPlatformError: (error) => formatCause(error.cause),
    GhDecodeError: (error) =>
      `unexpected gh response: ${formatCause(error.cause)}`,
  });

/** Run one GitHub GraphQL query through gh and decode the response. */
export const graphql = Effect.fn("graphql")(function* <
  S extends Schema.Constraint,
>(
  query: string,
  variables: Readonly<Record<string, string | number | boolean | null>>,
  schema: S,
) {
  return yield* Api.json(
    {
      endpoint: "graphql",
      method: "POST",
      body: { query, variables },
      options: GH_OPTIONS,
    },
    schema,
  );
});
