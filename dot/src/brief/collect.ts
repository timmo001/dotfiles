import { Effect, Schema } from "effect";
import type { GitNotificationThread } from "../types.js";
import { siteMatches, linkBrowserName } from "../lib/linkBrowser.js";
import {
  Login,
  authorLogin,
  ghErrorMessage,
  graphql,
  isOpenThread,
  quote,
  threadLocation,
} from "../lib/pullRequestReviews.js";
import {
  PageInfo,
  PullRequestNode,
  checkContexts,
  checkName,
  checkUrl,
  isFailedCheck,
  pullRequestFields,
} from "../lib/pullRequestSearch.js";
import { Config } from "../services/Config.js";
import { WORK_TIME_BROWSER } from "../services/GitConfig.js";
import { textLooksLikeBotActivity } from "../git/services/botActivity.js";
import { GitHub } from "../git/services/GitHub.js";
import { GitNotifications } from "../git/services/GitNotifications.js";
import { inspectNotification } from "../git/services/notificationReview.js";
import type { BriefConfig, BriefRule } from "./config.js";

/** GitHub could not be searched for the brief. */
export class BriefCollectError extends Schema.TaggedError<BriefCollectError>()(
  "BriefCollectError",
  { message: Schema.String },
) {}

/** A failing check on a pull request. */
const FailingCheck = Schema.Struct({
  name: Schema.String,
  url: Schema.optionalKey(Schema.String),
});

/** One thing the brief may list: a PR, issue, notification or failing CI. */
export const BriefItem = Schema.Struct({
  /** Stable key, such as `pr:owner/repo#12` or `notification:<thread id>`. */
  id: Schema.String,
  kind: Schema.Literals(["pr", "issue", "notification", "ci"]),
  repo: Schema.String,
  title: Schema.String,
  /** Whether it's a draft pull request. */
  draft: Schema.optionalKey(Schema.Boolean),
  url: Schema.String,
  /** Why it involves me: `review_requested`, `ci_failed`, `author`, `assigned`, a notification reason or `involves`. */
  reason: Schema.String,
  /** Review and comment signals waiting on me. */
  feedback: Schema.Array(Schema.String),
  updatedAt: Schema.String,
  /** Whether GitHub has an unread notification for it. */
  unread: Schema.Boolean,
  work: Schema.Boolean,
  crossover: Schema.Boolean,
  failing: Schema.Array(FailingCheck),
  /** Markdown with open review threads and recent comments, for follow-up prompts. */
  detail: Schema.String,
});

/** Decoded {@link BriefItem}. */
export type BriefItem = typeof BriefItem.Type;

/** Whether a brief rule applies to an item. */
export const ruleMatches = (rule: BriefRule, item: BriefItem) =>
  (rule.match === undefined ||
    siteMatches({ match: rule.match }, new URL(item.url))) &&
  (rule.reason === undefined || item.reason === rule.reason) &&
  (rule.feedback === undefined || item.feedback.includes(rule.feedback));

const Comment = Schema.Struct({
  body: Schema.String,
  url: Schema.String,
  createdAt: Schema.String,
  author: Login,
});

const PullRequestResult = Schema.Struct({
  ...PullRequestNode.fields,
  __typename: Schema.Literal("PullRequest"),
});

const IssueResult = Schema.Struct({
  __typename: Schema.Literal("Issue"),
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  author: Login,
  repository: Schema.Struct({ nameWithOwner: Schema.String }),
  assignees: Schema.Struct({ nodes: Schema.Array(Login) }),
  comments: Schema.Struct({
    totalCount: Schema.Int,
    nodes: Schema.optionalKey(Schema.Array(Comment)),
  }),
});

type PullRequestResult = typeof PullRequestResult.Type;

type IssueResult = typeof IssueResult.Type;

const SearchResult = Schema.Union([PullRequestResult, IssueResult]);

const BriefResponse = Schema.Struct({
  data: Schema.Struct({
    viewer: Schema.Struct({ login: Schema.String }),
    search: Schema.Struct({
      pageInfo: PageInfo,
      nodes: Schema.Array(SearchResult),
    }),
  }),
});

const BRIEF_QUERY = `query($q: String!, $first: Int!, $cursor: String, $bodies: Boolean!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: $first, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on PullRequest {
        ${pullRequestFields}
      }
      ... on Issue {
        number title url createdAt updatedAt
        author { login }
        repository { nameWithOwner }
        assignees(first: 10) { nodes { login } }
        comments(last: 10) {
          totalCount
          nodes @include(if: $bodies) { body url createdAt author { login } }
        }
      }
    }
  }
}`;

/** Most recently updated items fetched from the involvement search. */
const INVOLVED_LIMIT = 60;

/** Involvement older than this is left out. */
const INVOLVED_DAYS = 60;

const PAGE_SIZE = 20;

const COMMENT_LENGTH = 1500;

const CI_TYPES = new Set(["WorkflowRun", "CheckSuite"]);

const excerpt = (body: string) =>
  body.length > COMMENT_LENGTH ? `${body.slice(0, COMMENT_LENGTH)}…` : body;

const isPerson = (login: typeof Login.Type) =>
  login !== null && !textLooksLikeBotActivity(login.login);

const latest = (times: readonly (string | null | undefined)[]) =>
  times.reduce<string>((max, time) => (time && time > max ? time : max), "");

const search = Effect.fn("brief.search")(function* (
  query: string,
  limit: number,
) {
  const nodes: (typeof SearchResult.Type)[] = [];
  let viewer = "";
  let cursor: string | null = null;

  do {
    const response: typeof BriefResponse.Type = yield* graphql(
      BRIEF_QUERY,
      {
        q: query,
        first: Math.min(PAGE_SIZE, limit - nodes.length),
        cursor,
        bodies: true,
      },
      BriefResponse,
    );

    viewer = response.data.viewer.login;
    nodes.push(...response.data.search.nodes);
    cursor = response.data.search.pageInfo.hasNextPage
      ? response.data.search.pageInfo.endCursor
      : null;
  } while (cursor !== null && nodes.length < limit);

  return { viewer, nodes };
});

/** A comment's author, marked when it's me so prompts can tell my replies apart. */
const commenter = (author: typeof Login.Type, me: string) =>
  `${authorLogin(author)}${author?.login === me ? " (me)" : ""}`;

function pullRequestItem(
  node: PullRequestResult,
  me: string,
  reviewRequested: boolean,
): Omit<BriefItem, "work" | "crossover"> {
  const repo = node.repository.nameWithOwner;
  const mine = node.author?.login === me;
  const byMe = (login: typeof Login.Type) => login?.login === me;
  const comments = node.comments.nodes ?? [];

  const openThreads = node.reviewThreads.nodes
    .filter(isOpenThread)
    .filter((thread) => {
      const nodes = thread.comments.nodes;
      const last = nodes.at(-1);

      return (
        last !== undefined &&
        !byMe(last.author) &&
        (mine || byMe(nodes[0]?.author ?? null))
      );
    });

  const threadComments = node.reviewThreads.nodes.flatMap(
    (thread) => thread.comments.nodes,
  );

  const mineAt = latest([
    mine ? node.createdAt : undefined,
    ...comments.filter((c) => byMe(c.author)).map((c) => c.createdAt),
    ...node.latestReviews.nodes
      .filter((r) => byMe(r.author))
      .map((r) => r.submittedAt),
    ...threadComments.filter((c) => byMe(c.author)).map((c) => c.createdAt),
  ]);

  const othersAt = latest([
    ...comments
      .filter((c) => !byMe(c.author) && isPerson(c.author))
      .map((c) => c.createdAt),
    ...node.latestReviews.nodes
      .filter((r) => !byMe(r.author) && isPerson(r.author))
      .map((r) => r.submittedAt),
    ...threadComments
      .filter((c) => !byMe(c.author) && isPerson(c.author))
      .map((c) => c.createdAt),
  ]);

  const failing = mine
    ? checkContexts(node)
        .filter(isFailedCheck)
        .map((context) => {
          const url = checkUrl(context);

          return { name: checkName(context), ...(url && { url }) };
        })
    : [];

  const feedback = [
    reviewRequested ? "review_requested" : "",
    mine && node.reviewDecision === "CHANGES_REQUESTED"
      ? "changes_requested"
      : "",
    openThreads.length > 0 ? "open_threads" : "",
    mineAt !== "" && othersAt > mineAt ? "new_comments" : "",
  ].filter(Boolean);

  const detail = [
    ...(failing.length > 0
      ? [
          "Failing checks:",
          ...failing.map(
            (check) => `- ${check.name}${check.url ? `: ${check.url}` : ""}`,
          ),
          "",
        ]
      : []),
    ...openThreads.flatMap((thread) => [
      `Open review thread at ${threadLocation(thread)} (${thread.comments.nodes[0]?.url ?? ""}):`,
      ...thread.comments.nodes.flatMap((comment) => [
        `**${commenter(comment.author, me)}**:`,
        quote(excerpt(comment.body ?? "")),
      ]),
      "",
    ]),
    ...(comments.length > 0 ? ["Recent comments:"] : []),
    ...comments.flatMap((comment) => [
      `**${commenter(comment.author, me)}** (${comment.createdAt}, ${comment.url}):`,
      quote(excerpt(comment.body)),
    ]),
  ].join("\n");

  return {
    id: `pr:${repo}#${node.number}`,
    kind: failing.length > 0 ? "ci" : "pr",
    repo,
    title: node.title,
    draft: node.isDraft,
    url: node.url,
    reason: reviewRequested
      ? "review_requested"
      : failing.length > 0
        ? "ci_failed"
        : mine
          ? "author"
          : "involves",
    feedback,
    updatedAt: node.updatedAt,
    unread: false,
    failing,
    detail,
  };
}

function issueItem(
  node: IssueResult,
  me: string,
): Omit<BriefItem, "work" | "crossover"> {
  const repo = node.repository.nameWithOwner;
  const mine = node.author?.login === me;
  const comments = node.comments.nodes ?? [];
  const byMe = (login: typeof Login.Type) => login?.login === me;

  const mineAt = latest([
    mine ? node.createdAt : undefined,
    ...comments.filter((c) => byMe(c.author)).map((c) => c.createdAt),
  ]);

  const othersAt = latest(
    comments
      .filter((c) => !byMe(c.author) && isPerson(c.author))
      .map((c) => c.createdAt),
  );

  return {
    id: `issue:${repo}#${node.number}`,
    kind: "issue",
    repo,
    title: node.title,
    url: node.url,
    reason: node.assignees.nodes.some(byMe)
      ? "assigned"
      : mine
        ? "author"
        : "involves",
    feedback: mineAt !== "" && othersAt > mineAt ? ["new_comments"] : [],
    updatedAt: node.updatedAt,
    unread: false,
    failing: [],
    detail: comments
      .flatMap((comment) => [
        `**${commenter(comment.author, me)}** (${comment.createdAt}, ${comment.url}):`,
        quote(excerpt(comment.body)),
      ])
      .join("\n"),
  };
}

function notificationItem(
  thread: GitNotificationThread,
): Omit<BriefItem, "work" | "crossover"> {
  return {
    id: `notification:${thread.id}`,
    kind: CI_TYPES.has(thread.type) ? "ci" : "notification",
    repo: thread.repo,
    title: thread.title,
    url: thread.webUrl,
    reason: thread.reason,
    feedback: thread.reason === "review_requested" ? ["review_requested"] : [],
    updatedAt: thread.updatedAt ?? "",
    unread: thread.unread,
    failing: [],
    detail: `GitHub notification: ${thread.type} · ${thread.reason}`,
  };
}

/** Notifications the dependency dismiss job would clear: merged dependency updates. */
const mergedDependencyUpdate = Effect.fn("brief.mergedDependencyUpdate")(
  function* (thread: GitNotificationThread) {
    if (!thread.bot || thread.type !== "PullRequest") return false;

    const github = yield* GitHub;
    const review = yield* inspectNotification(thread, github);

    return (
      review.category === "dependencies" ||
      review.detail.startsWith("Merged PR · Dependency update")
    );
  },
);

/** Gather open PRs and issues I'm involved in, plus unread notifications. */
export const collectBrief = Effect.fn("brief.collect")(function* (
  brief: BriefConfig,
  now: number,
) {
  const config = yield* Config;
  const notifications = yield* GitNotifications;

  const since = new Date(now - INVOLVED_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [involved, requested, inbox] = yield* Effect.all(
    [
      search(
        `involves:@me is:open archived:false updated:>=${since} sort:updated-desc`,
        INVOLVED_LIMIT,
      ),
      search("review-requested:@me is:open is:pr archived:false", 50),
      notifications.query({ barFilter: true }),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.mapError(
      (error) =>
        new BriefCollectError({
          message: `GitHub search failed: ${ghErrorMessage(error)}`,
        }),
    ),
  );

  const me = involved.viewer || requested.viewer;
  const requestedUrls = new Set(requested.nodes.map((node) => node.url));
  const items = new Map<string, Omit<BriefItem, "work" | "crossover">>();

  for (const node of [...requested.nodes, ...involved.nodes]) {
    if (items.has(node.url)) continue;

    items.set(
      node.url,
      node.__typename === "PullRequest"
        ? pullRequestItem(node, me, requestedUrls.has(node.url))
        : issueItem(node, me),
    );
  }

  const dependencyUpdates = yield* Effect.forEach(
    inbox.threads,
    mergedDependencyUpdate,
    { concurrency: 4 },
  );

  inbox.threads.forEach((thread, index) => {
    if (dependencyUpdates[index]) return;

    const existing = items.get(thread.webUrl);

    if (!existing) {
      items.set(`notification:${thread.id}`, notificationItem(thread));

      return;
    }

    items.set(thread.webUrl, {
      ...existing,
      unread: existing.unread || thread.unread,
      reason: existing.reason === "involves" ? thread.reason : existing.reason,
    });
  });

  const links = config.gitConfig.links;

  return [...items.values()].map((item): BriefItem => {
    const browser = linkBrowserName(config.gitConfig, new URL(item.url));

    const linked = {
      ...item,
      work:
        browser !== undefined &&
        (browser === WORK_TIME_BROWSER || browser === links?.work),
      crossover: false,
    };

    return brief.rules.reduce(
      (current, rule) =>
        ruleMatches(rule, current)
          ? {
              ...current,
              ...(rule.work !== undefined && { work: rule.work }),
              ...(rule.crossover !== undefined && {
                crossover: rule.crossover,
              }),
            }
          : current,
      linked,
    );
  });
});
