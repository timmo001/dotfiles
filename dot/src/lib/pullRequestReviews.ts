import { Api, Gh, type GhError } from "@timmo001/effect-gh";
import { Effect, Match, Predicate, Schema } from "effect";
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

/** Shortened commit SHA for display. */
export const shortSha = (sha: string) => sha.slice(0, 9);

const PullRequestInfo = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: Schema.String,
  headRefOid: Schema.String,
});

/** A pull request resolved to its repository and head commit. */
export interface PullRequestRef {
  /** Pull request number. */
  readonly number: number;
  /** Pull request title. */
  readonly title: string;
  /** Pull request web URL. */
  readonly url: string;
  /** Repository owner. */
  readonly owner: string;
  /** Repository name. */
  readonly name: string;
  /** Repository slug as `owner/name`. */
  readonly repo: string;
  /** Head commit SHA when resolved. */
  readonly head: string;
}

/** A pull request URL that does not name a GitHub repository. */
export class PullRequestUrlError extends Schema.TaggedError<PullRequestUrlError>()(
  "PullRequestUrlError",
  { url: Schema.String },
) {}

/** Look up a pull request with gh; `undefined` selects the current branch's pull request. */
export const viewPullRequest = Effect.fn("viewPullRequest")(function* (
  selector: number | undefined,
  repo: string | undefined,
) {
  const gh = yield* Gh;

  return yield* gh.json(
    [
      "pr",
      "view",
      ...(repo ? ["--repo", repo] : []),
      "--json",
      "number,title,url,state,headRefOid",
      ...(selector === undefined ? [] : ["--", String(selector)]),
    ],
    PullRequestInfo,
    GH_OPTIONS,
  );
});

/** Resolve a pull request to its repository and head commit. */
export const resolvePullRequest = Effect.fn("resolvePullRequest")(function* (
  selector: number | undefined,
  repo: string | undefined,
) {
  const pr = yield* viewPullRequest(selector, repo);
  const match = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(pr.url);

  if (!match?.[1] || !match[2])
    return yield* new PullRequestUrlError({ url: pr.url });

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    owner: match[1],
    name: match[2],
    repo: `${match[1]}/${match[2]}`,
    head: pr.headRefOid,
  } satisfies PullRequestRef;
});

/** One-line description of a pull request lookup failure. */
export const pullRequestLookupMessage = (
  error: GhError | PullRequestUrlError,
) =>
  Predicate.isTagged(error, "PullRequestUrlError")
    ? `Unrecognised pull request URL: ${error.url}`
    : `Could not resolve the pull request: ${ghErrorMessage(error)}`;

/** A submitted, pending or dismissed pull request review. */
export const Review = Schema.Struct({
  id: Schema.String,
  state: Schema.String,
  submittedAt: Schema.NullOr(Schema.String),
  body: Schema.String,
  url: Schema.String,
  author: Login,
  commit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
  ...Minimized,
});

/** Decoded {@link Review}. */
export type Review = typeof Review.Type;

const ReviewResponse = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({
      pullRequest: Schema.Struct({
        reviewRequests: Schema.Struct({
          nodes: Schema.Array(
            Schema.Struct({
              requestedReviewer: Schema.NullOr(
                Schema.Struct({
                  __typename: Schema.String,
                  login: Schema.optionalKey(Schema.String),
                }),
              ),
            }),
          ),
        }),
        reviews: Schema.Struct({ nodes: Schema.Array(Review) }),
        reviewThreads: Schema.Struct({
          pageInfo: Schema.Struct({
            hasNextPage: Schema.Boolean,
            endCursor: Schema.NullOr(Schema.String),
          }),
          nodes: Schema.Array(ReviewThread),
        }),
      }),
    }),
  }),
});

const REVIEW_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewRequests(first: 50) {
        nodes { requestedReviewer { __typename ... on Bot { login } ... on User { login } } }
      }
      reviews(last: 100) {
        nodes {
          id state submittedAt body url isMinimized minimizedReason
          author { login }
          commit { oid }
        }
      }
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { ${reviewThreadFields({ comments: 100 })} }
      }
    }
  }
}`;

/** Reviews, every review thread and outstanding bot review requests of one pull request. */
export interface ReviewState {
  /** The latest 100 reviews, including pending and dismissed ones. */
  readonly reviews: readonly Review[];
  /** Every review thread, open or not. */
  readonly threads: readonly ReviewThread[];
  /** Bot logins with a review still requested. */
  readonly botRequests: readonly string[];
}

/** Fetch the review state of a pull request, following every page of threads. */
export const fetchReviews = Effect.fn("fetchReviews")(function* (
  pr: Pick<PullRequestRef, "owner" | "name" | "number">,
) {
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;
  let reviews: readonly Review[] = [];
  let botRequests: string[] = [];

  do {
    const response: typeof ReviewResponse.Type = yield* graphql(
      REVIEW_QUERY,
      { owner: pr.owner, name: pr.name, number: pr.number, cursor },
      ReviewResponse,
    );

    const pullRequest = response.data.repository.pullRequest;
    threads.push(...pullRequest.reviewThreads.nodes);

    if (cursor === null) {
      reviews = pullRequest.reviews.nodes;
      botRequests = pullRequest.reviewRequests.nodes.flatMap((node) =>
        node.requestedReviewer?.__typename === "Bot" &&
        node.requestedReviewer.login
          ? [node.requestedReviewer.login]
          : [],
      );
    }

    cursor = pullRequest.reviewThreads.pageInfo.hasNextPage
      ? pullRequest.reviewThreads.pageInfo.endCursor
      : null;
  } while (cursor !== null);

  return { reviews, threads, botRequests } satisfies ReviewState;
});

function renderComment(comment: ReviewComment): string {
  const hidden = comment.isMinimized
    ? ` (minimized as ${comment.minimizedReason ?? "unknown"})`
    : "";

  return `**${authorLogin(comment.author)}** at ${comment.createdAt}${hidden} (${comment.url}):\n\n${quote(comment.body ?? "")}\n`;
}

/** Markdown review dump: reviews newest first, open threads in full, dismissed threads with replies only. */
export function renderReviews(pr: PullRequestRef, state: ReviewState): string {
  const { reviews, threads, botRequests } = state;

  const submitted = new Map(
    reviews.map((review) => [review.id, review.submittedAt ?? ""]),
  );

  const threadTime = (thread: ReviewThread) => {
    const [first] = thread.comments.nodes;

    return (
      (first?.pullRequestReview && submitted.get(first.pullRequestReview.id)) ||
      first?.createdAt ||
      ""
    );
  };

  const ordered = [...threads].sort((a, b) =>
    threadTime(b).localeCompare(threadTime(a)),
  );

  const open = ordered.filter(isOpenThread);
  const dismissed = ordered.filter((thread) => !isOpenThread(thread));

  const out: string[] = [
    `## Reviews for #${pr.number}: ${pr.title}`,
    "",
    `Head ${shortSha(pr.head)}. ${pr.url}`,
  ];

  if (botRequests.length > 0)
    out.push(`Review still requested from: ${botRequests.join(", ")}`);

  out.push("", "### Reviews (newest first)", "");

  const sortedReviews = [...reviews]
    .filter((review) => review.state !== "PENDING")
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));

  if (sortedReviews.length === 0) out.push("None.", "");

  const latestByAuthor = new Set<string>();

  for (const review of sortedReviews) {
    const commit = review.commit?.oid;
    const reviewer = authorLogin(review.author);
    const superseded = latestByAuthor.has(reviewer);

    latestByAuthor.add(reviewer);
    const older = commit && commit !== pr.head ? " (older commit)" : "";

    out.push(
      `#### ${reviewer} ${review.state} at ${review.submittedAt ?? "?"} on ${commit ? shortSha(commit) : "?"}${older}`,
      review.url,
      "",
    );

    if (review.isMinimized || review.state === "DISMISSED")
      out.push(
        `Dismissed${review.isMinimized ? ` (minimized as ${review.minimizedReason ?? "unknown"})` : ""}; body omitted.`,
        "",
      );
    else if (superseded)
      out.push(
        "Superseded by a later review from the same author; body omitted.",
        "",
      );
    else if (review.body.trim()) out.push(quote(review.body), "");
  }

  out.push(`### Open threads (${open.length})`, "");

  for (const thread of open) {
    out.push(`#### ${threadLocation(thread)} [${thread.id}]`, "");
    out.push(...thread.comments.nodes.map(renderComment));
  }

  out.push(
    `### Dismissed threads (${dismissed.length})`,
    "",
    "Resolved or minimized by a maintainer. Treat as guidance: a resolution with no reply usually means it was addressed; replies explain won't-fix or incorrect feedback.",
    "",
  );

  for (const thread of dismissed) {
    const replies = thread.comments.nodes.slice(1);
    const [first] = thread.comments.nodes;

    out.push(
      `#### ${threadLocation(thread)} [${thread.id}] ${threadStatus(thread)}`,
      "",
      `Started by ${authorLogin(first?.author ?? null)}: ${first?.url ?? ""}`,
      "",
    );

    if (replies.length === 0) out.push("No reply.", "");
    else out.push(...replies.map(renderComment));
  }

  return out.join("\n");
}
