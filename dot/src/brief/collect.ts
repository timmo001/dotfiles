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
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  state: Schema.optionalKey(Schema.Literals(["open", "closed", "merged"])),
  /** Facts shown at work time, such as `stale`; they never change the score. */
  context: Schema.optionalKey(Schema.Array(Schema.String)),
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
  state: Schema.String,
  author: Login,
  repository: Schema.Struct({ nameWithOwner: Schema.String }),
  labels: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
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
      issueCount: Schema.Int,
      pageInfo: PageInfo,
      nodes: Schema.Array(SearchResult),
    }),
  }),
});

const ActivityResponse = Schema.Struct({
  data: Schema.Struct({
    search: Schema.Struct({
      nodes: Schema.Array(
        Schema.Struct({
          repository: Schema.Struct({ nameWithOwner: Schema.String }),
          labels: Schema.Struct({
            nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
          }),
        }),
      ),
    }),
  }),
});

const ACTIVITY_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        repository { nameWithOwner }
        labels(first: 30) { nodes { name } }
      }
    }
  }
}`;

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
        number title url createdAt updatedAt state
        author { login }
        repository { nameWithOwner }
        labels(first: 20) { nodes { name } }
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
  bodies = true,
) {
  const nodes: (typeof SearchResult.Type)[] = [];
  let viewer = "";
  let total = 0;
  let cursor: string | null = null;

  do {
    const response: typeof BriefResponse.Type = yield* graphql(
      BRIEF_QUERY,
      {
        q: query,
        first: Math.min(PAGE_SIZE, limit - nodes.length),
        cursor,
        bodies,
      },
      BriefResponse,
    );

    viewer = response.data.viewer.login;
    total = response.data.search.issueCount;
    nodes.push(...response.data.search.nodes);
    cursor = response.data.search.pageInfo.hasNextPage
      ? response.data.search.pageInfo.endCursor
      : null;
  } while (cursor !== null && nodes.length < limit);

  return { viewer, nodes, total };
});

/** `open`, `closed` or `merged` from GitHub's upper-case state. */
const itemState = (state: string) =>
  state === "MERGED" ? "merged" : state === "CLOSED" ? "closed" : "open";

const labelNames = (labels: { readonly nodes: readonly { name: string }[] }) =>
  labels.nodes.map((label) => label.name);

/** Facts shared by PRs and issues. */
const commonContext = (state: string, labels: readonly string[]) => [
  state === "open" ? "" : state,
  labels.includes("stale") && !labels.includes("no-stale")
    ? "stale, the bot will close it"
    : "",
];

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

  const failing =
    mine && node.state === "OPEN"
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

  const state = itemState(node.state);
  const labels = labelNames(node.labels);
  const pushedAt = node.commits.nodes[0]?.commit.committedDate ?? "";

  const changesRequested = node.latestReviews.nodes.filter(
    (review) => review.state === "CHANGES_REQUESTED",
  );

  const threadStarters = openThreads.map(
    (thread) => thread.comments.nodes[0]?.author ?? null,
  );

  const context = [
    ...commonContext(state, labels),
    threadStarters.length > 0 && !threadStarters.some(isPerson)
      ? threadStarters.every((login) => /copilot/i.test(login?.login ?? ""))
        ? "Copilot threads only"
        : "bot threads only"
      : "",
    feedback.includes("changes_requested") &&
    changesRequested.length > 0 &&
    changesRequested.every(
      (review) =>
        !isPerson(review.author) &&
        review.submittedAt !== null &&
        review.submittedAt < pushedAt,
    )
      ? "bot review, pushed since"
      : "",
  ].filter(Boolean);

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
    labels,
    state,
    context,
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

  const state = itemState(node.state);
  const labels = labelNames(node.labels);

  const others = node.assignees.nodes.flatMap((login) =>
    login && !byMe(login) ? [`@${login.login}`] : [],
  );

  const context = [
    ...commonContext(state, labels),
    others.length > 0 && !node.assignees.nodes.some(byMe)
      ? `assigned to ${others.join(", ")}`
      : "",
  ].filter(Boolean);

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
    labels,
    state,
    context,
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

/** A work-time section of other items, from one or more GitHub searches. */
export interface BriefList {
  readonly name: string;
  readonly items: readonly BriefItem[];
  /** Items to show, after leaving out those shown earlier. */
  readonly limit: number;
  /** Estimated matches across the searches, for "and N more". */
  readonly total: number;
  /** GitHub search page for the rest. */
  readonly url: string;
}

/** What the brief adds at work time. */
export interface BriefWorkLists {
  /** ISO date the window starts on. */
  readonly since: string;
  /** My work PRs merged or closed in the window. */
  readonly closed: readonly BriefItem[];
  /** My open authored and assigned work issues. */
  readonly tasks: readonly BriefItem[];
  /** Other people's PRs in the areas I work in. */
  readonly areas: readonly BriefList[];
  /** The interest scopes from `brief.yml`. */
  readonly scopes: readonly BriefList[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** GitHub web search for a query. */
export const searchUrl = (query: string) =>
  `https://github.com/search?type=${/\bis:issue\b/.test(query) ? "issues" : "pullrequests"}&q=${encodeURIComponent(query)}`;

const labelIgnored = (ignore: readonly string[], label: string) =>
  ignore.some((pattern) =>
    pattern.endsWith("*")
      ? label.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase())
      : label.toLowerCase() === pattern.toLowerCase(),
  );

/** A label as a section name, such as `System bridge` for `integration: system_bridge`. */
const areaName = (label: string) => {
  const name = label.replace(/^integration:\s*/i, "").replaceAll("_", " ");

  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
};

const searchFailed = (error: Parameters<typeof ghErrorMessage>[0]) =>
  new BriefCollectError({
    message: `GitHub search failed: ${ghErrorMessage(error)}`,
  });

/**
 * Gather open PRs and issues I'm involved in, plus unread notifications. With
 * `workSince`, also gather the work-time sections from that ISO date.
 */
export const collectBrief = Effect.fn("brief.collect")(function* (
  brief: BriefConfig,
  now: number,
  workSince?: string,
) {
  const config = yield* Config;
  const notifications = yield* GitNotifications;

  const since = isoDate(now - INVOLVED_DAYS * DAY_MS);

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
  ).pipe(Effect.mapError(searchFailed));

  const me = involved.viewer || requested.viewer;
  const requestedUrls = new Set(requested.nodes.map((node) => node.url));
  const items = new Map<string, Omit<BriefItem, "work" | "crossover">>();

  const toItem = (node: typeof SearchResult.Type, reviewRequested = false) =>
    node.__typename === "PullRequest"
      ? pullRequestItem(node, me, reviewRequested)
      : issueItem(node, me);

  for (const node of [...requested.nodes, ...involved.nodes]) {
    if (items.has(node.url)) continue;

    items.set(node.url, toItem(node, requestedUrls.has(node.url)));
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

  const classify = (item: Omit<BriefItem, "work" | "crossover">): BriefItem => {
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
  };

  if (workSince === undefined)
    return {
      items: [...items.values()].map((item) =>
        classify({ ...item, context: [] }),
      ),
      work: undefined,
    };

  const work = brief.work;

  const excluded = (item: BriefItem) =>
    work.exclude.some((match) => siteMatches({ match }, new URL(item.url)));

  const workItems = (nodes: readonly (typeof SearchResult.Type)[]) =>
    nodes
      .map((node) => classify(toItem(node)))
      .filter((item) => item.work && !excluded(item));

  const followSince = isoDate(now - work.followDays * DAY_MS);

  const activity = (query: string) =>
    graphql(ACTIVITY_QUERY, { q: query }, ActivityResponse).pipe(
      Effect.map((response) => response.data.search.nodes),
    );

  const [closed, authoredIssues, assignedIssues, authored, reviewed] =
    yield* Effect.all(
      [
        search(`is:pr author:@me closed:>=${workSince}`, 30, false),
        search("is:issue is:open author:@me archived:false", 50, false),
        search("is:issue is:open assignee:@me archived:false", 50, false),
        activity(`is:pr author:@me updated:>=${followSince}`),
        activity(`is:pr reviewed-by:@me -author:@me updated:>=${followSince}`),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.mapError(searchFailed));

  const closedItems = workItems(closed.nodes);

  const tasks = [
    ...new Map(
      workItems([...assignedIssues.nodes, ...authoredIssues.nodes]).map(
        (item) => [item.id, item],
      ),
    ).values(),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const scopeLabels = work.scopes
    .flatMap((scope) => scope.queries)
    .join(" ")
    .toLowerCase();

  const workRepo = (repo: string) =>
    classify({
      id: repo,
      kind: "pr",
      repo,
      title: "",
      url: `https://github.com/${repo}`,
      reason: "",
      feedback: [],
      updatedAt: "",
      unread: false,
      failing: [],
      detail: "",
    }).work;

  const counts = new Map<
    string,
    { repo: string; label: string; count: number }
  >();

  for (const [nodes, weight] of [
    [authored, 2],
    [reviewed, 1],
  ] as const)
    for (const node of nodes) {
      const repo = node.repository.nameWithOwner;

      for (const { name: label } of node.labels.nodes) {
        const key = `${repo}\n${label}`;

        if (labelIgnored(work.ignoreLabels, label)) continue;

        counts.set(key, {
          repo,
          label,
          count: (counts.get(key)?.count ?? 0) + weight,
        });
      }
    }

  const followed = [...counts.values()]
    .filter(
      ({ repo, label }) =>
        workRepo(repo) &&
        !scopeLabels.includes(`label:${label.toLowerCase()}`) &&
        !scopeLabels.includes(`label:"${label.toLowerCase()}"`),
    )
    .sort((a, b) => b.count - a.count)
    .slice(0, work.followAreas);

  const listSearch = (
    name: string,
    queries: readonly string[],
    limit: number,
  ) =>
    Effect.forEach(
      queries,
      (query) =>
        search(query, Math.min(limit + 10, 50), false).pipe(
          Effect.map((result) => ({ query, ...result })),
        ),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map((results): BriefList => {
        const fetched = results.flatMap((result) => workItems(result.nodes));
        const unique = new Map(fetched.map((item) => [item.id, item]));
        const fullest = results.toSorted((a, b) => b.total - a.total)[0];

        return {
          name,
          items: [...unique.values()].sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
          ),
          limit,
          total: Math.max(
            unique.size,
            results.reduce((sum, result) => sum + result.total, 0) -
              (fetched.length - unique.size),
          ),
          url: searchUrl(fullest?.query ?? queries[0] ?? ""),
        };
      }),
    );

  const [areas, scopes] = yield* Effect.all(
    [
      Effect.forEach(
        followed,
        ({ repo, label }) =>
          listSearch(
            areaName(label),
            [
              `repo:${repo} is:pr label:"${label}" updated:>=${workSince} -author:@me -author:app/renovate`,
            ],
            work.followLimit,
          ),
        { concurrency: "unbounded" },
      ),
      Effect.forEach(
        work.scopes,
        (scope) =>
          listSearch(
            scope.name,
            scope.queries.map((query) =>
              query.replaceAll("{since}", workSince),
            ),
            scope.limit,
          ),
        { concurrency: "unbounded" },
      ),
    ],
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError(searchFailed));

  const closedByUrl = new Map(closedItems.map((item) => [item.url, item]));

  return {
    items: [...items.values()].map((item) => {
      const done = item.state === undefined && closedByUrl.get(item.url);

      return classify(
        done && done.state
          ? {
              ...item,
              state: done.state,
              context: [done.state, ...(item.context ?? [])],
            }
          : item,
      );
    }),
    work: {
      since: workSince,
      closed: closedItems,
      tasks,
      areas,
      scopes,
    } satisfies BriefWorkLists,
  };
});
