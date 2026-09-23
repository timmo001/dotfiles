import { Api, Gh, type GhError } from "@timmo001/effect-gh";
import { Clock, Effect, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import {
  managedGitRepoForGitHub,
  managedGitRepoForPath,
} from "../services/GitConfig.js";

/** Orderings for {@link prQueue}. */
export type PrQueueSort = "effort" | "updated" | "created" | "size";

/** Options for {@link prQueue}. */
export interface PrQueueOptions {
  /** Repository slug; defaults to the current checkout. */
  readonly repo: string | undefined;
  /** Search overriding the repository's configured `review_search`. */
  readonly search: string | undefined;
  /** Start of the activity window: `today`, `yesterday`, a date, a timestamp or a relative age. */
  readonly since: string;
  /** Maximum pull requests listed from the search. */
  readonly limit: number;
  /** Effort groups smallest first; the others print one table in that order. */
  readonly sort: PrQueueSort;
  /** Print JSON instead of Markdown. */
  readonly json: boolean;
  /** Limit output to the review queue or the activity window; omitted prints both. */
  readonly only: "queue" | "activity" | undefined;
}

const GH = { timeout: "2 minutes" } as const;

const SMALL_LINES = 150;

const MEDIUM_LINES = 400;

const ACTIVITY_LIMIT = 500;

const FAILED_RUNS = new Set(["FAILURE", "TIMED_OUT", "STARTUP_FAILURE"]);

const FAILED_STATUSES = new Set(["FAILURE", "ERROR"]);

const HOURS = new Map([
  ["h", 1],
  ["d", 24],
  ["w", 24 * 7],
]);

const FIRST_TIMERS = new Set(["FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR"]);

const Login = Schema.NullOr(Schema.Struct({ login: Schema.String }));

const PageInfo = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
});

const Context = Schema.Struct({
  __typename: Schema.String,
  name: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  conclusion: Schema.optionalKey(Schema.NullOr(Schema.String)),
  context: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(Schema.String),
});

type Context = typeof Context.Type;

const QueueNode = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  additions: Schema.Int,
  deletions: Schema.Int,
  changedFiles: Schema.Int,
  reviewDecision: Schema.NullOr(Schema.String),
  authorAssociation: Schema.String,
  author: Login,
  labels: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
  comments: Schema.Struct({ totalCount: Schema.Int }),
  latestReviews: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ author: Login, state: Schema.String })),
  }),
  commits: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        commit: Schema.Struct({
          statusCheckRollup: Schema.NullOr(
            Schema.Struct({
              contexts: Schema.Struct({ nodes: Schema.Array(Context) }),
            }),
          ),
        }),
      }),
    ),
  }),
});

type QueueNode = typeof QueueNode.Type;

const ActivityNode = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: Schema.String,
  createdAt: Schema.String,
  mergedAt: Schema.NullOr(Schema.String),
  closedAt: Schema.NullOr(Schema.String),
  additions: Schema.Int,
  deletions: Schema.Int,
  changedFiles: Schema.Int,
  author: Login,
  mergedBy: Login,
  labels: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
  }),
});

type ActivityNode = typeof ActivityNode.Type;

const searchResponse = <S extends Schema.Top>(node: S) =>
  Schema.Struct({
    data: Schema.Struct({
      search: Schema.Struct({
        issueCount: Schema.Int,
        pageInfo: PageInfo,
        nodes: Schema.Array(node),
      }),
    }),
  });

const QueueResponse = searchResponse(QueueNode);

const ActivityResponse = searchResponse(ActivityNode);

const CountResponse = Schema.Struct({
  data: Schema.Struct({
    search: Schema.Struct({ issueCount: Schema.Int }),
  }),
});

const QUEUE_QUERY = `query($q: String!, $first: Int!, $cursor: String) {
  search(query: $q, type: ISSUE, first: $first, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url createdAt updatedAt additions deletions changedFiles reviewDecision authorAssociation
        author { login }
        labels(first: 30) { nodes { name } }
        comments { totalCount }
        latestReviews(first: 20) { nodes { author { login } state } }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion }
                    ... on StatusContext { context state }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const ACTIVITY_QUERY = `query($q: String!, $first: Int!, $cursor: String) {
  search(query: $q, type: ISSUE, first: $first, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url state createdAt mergedAt closedAt additions deletions changedFiles
        author { login }
        mergedBy { login }
        labels(first: 30) { nodes { name } }
      }
    }
  }
}`;

const COUNT_QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 1) { issueCount }
}`;

type Group = "small" | "medium" | "large" | "notReady";

const GROUP_TITLES: Record<Group, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  notReady: "Not ready",
};

interface QueueItem {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly author: string;
  readonly firstTimer: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly newSince: boolean;
  readonly updatedSince: boolean;
  readonly reviewDecision: string | null;
  readonly reviews: readonly string[];
  readonly labels: readonly string[];
  readonly comments: number;
  readonly failing: readonly string[];
  readonly pending: number;
  readonly group: Group;
}

interface ActivityItem {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly author: string;
  readonly state: string;
  readonly createdAt: string;
  readonly at: string;
  readonly mergedBy?: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly labels: readonly string[];
}

interface ActivityList {
  readonly total: number;
  readonly items: readonly ActivityItem[];
}

class PrQueueError extends Schema.TaggedError<PrQueueError>()("PrQueueError", {
  message: Schema.String,
}) {}

const author = (login: { readonly login: string } | null) =>
  login?.login ?? "ghost";

const ghMessage = (error: GhError) =>
  "stderr" in error ? error.stderr.trim() : error._tag;

const searchTime = (millis: number) =>
  new Date(millis).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Resolve `--since` to epoch milliseconds using local time for dates. */
function parseSince(value: string, now: number): number | undefined {
  const trimmed = value.trim().toLowerCase();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  if (trimmed === "today") return midnight.getTime();

  if (trimmed === "yesterday") return midnight.setDate(midnight.getDate() - 1);

  const relative = /^(\d+)\s*([hdw])$/.exec(trimmed);

  if (relative?.[1] && relative[2]) {
    const hours = HOURS.get(relative[2]) ?? 0;

    return now - Number(relative[1]) * hours * 60 * 60 * 1000;
  }

  const date = /^(\d{4})-(\d\d)-(\d\d)$/.exec(trimmed);

  if (date)
    return new Date(
      Number(date[1]),
      Number(date[2]) - 1,
      Number(date[3]),
    ).getTime();

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? undefined : parsed;
}

function contextName(context: Context): string {
  return context.name ?? context.context ?? context.__typename;
}

function classify(node: QueueNode, since: number): QueueItem {
  const contexts =
    node.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];

  const failing = [
    ...new Set(
      contexts
        .filter((context) =>
          context.__typename === "CheckRun"
            ? FAILED_RUNS.has(context.conclusion ?? "")
            : FAILED_STATUSES.has(context.state ?? ""),
        )
        .map(contextName),
    ),
  ];

  const pending = contexts.filter((context) =>
    context.__typename === "CheckRun"
      ? context.status !== "COMPLETED"
      : context.state === "PENDING" || context.state === "EXPECTED",
  ).length;

  const lines = node.additions + node.deletions;

  const group: Group =
    failing.length > 0 || node.reviewDecision === "CHANGES_REQUESTED"
      ? "notReady"
      : lines <= SMALL_LINES
        ? "small"
        : lines <= MEDIUM_LINES
          ? "medium"
          : "large";

  return {
    number: node.number,
    title: node.title,
    url: node.url,
    author: author(node.author),
    firstTimer: FIRST_TIMERS.has(node.authorAssociation),
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFiles,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    newSince: Date.parse(node.createdAt) >= since,
    updatedSince: Date.parse(node.updatedAt) >= since,
    reviewDecision: node.reviewDecision,
    reviews: node.latestReviews.nodes.map(
      (review) => `${author(review.author)}:${review.state.toLowerCase()}`,
    ),
    labels: node.labels.nodes.map((label) => label.name),
    comments: node.comments.totalCount,
    failing,
    pending,
    group,
  };
}

const lines = (item: QueueItem) => item.additions + item.deletions;

const COMPARE: Record<PrQueueSort, (a: QueueItem, b: QueueItem) => number> = {
  effort: (a, b) => lines(a) - lines(b),
  size: (a, b) => lines(a) - lines(b),
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
};

const size = (item: {
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
}) =>
  `+${item.additions}/-${item.deletions}, ${item.changedFiles} file${item.changedFiles === 1 ? "" : "s"}`;

const cell = (text: string) => text.replaceAll("|", "\\|").replace(/\s+/g, " ");

function renderItem(item: QueueItem): string {
  const checks =
    item.failing.length > 0
      ? `failing: ${item.failing.join(", ")}`
      : item.pending > 0
        ? `${item.pending} pending`
        : "passing";

  const notes = [
    item.newSince ? "new" : item.updatedSince ? "updated" : "",
    item.firstTimer ? "first-time contributor" : "",
    item.reviewDecision === "CHANGES_REQUESTED" ? "changes requested" : "",
    item.comments > 0
      ? `${item.comments} comment${item.comments === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);

  return `| [#${item.number}](${item.url}) ${cell(item.title)} | ${item.author} | ${size(item)} | ${item.updatedAt.slice(0, 10)} | ${checks} | ${item.reviews.join(", ") || "none"} | ${cell(item.labels.join(", "))} | ${notes.join("; ")} |`;
}

function renderActivity(title: string, list: ActivityList): string[] {
  const out = [`### ${title} (${list.total})`, ""];

  if (list.items.length === 0) return [...out, "None.", ""];

  out.push(
    ...list.items.map(
      (item) =>
        `- [#${item.number}](${item.url}) ${item.title} (${item.author}${item.mergedBy ? `, merged by ${item.mergedBy}` : ""}; ${item.at.slice(0, 16).replace("T", " ")}; ${size(item)}${item.labels.length > 0 ? `; ${item.labels.join(", ")}` : ""})`,
    ),
  );

  if (list.total > list.items.length)
    out.push(`- ...and ${list.total - list.items.length} more`);

  return [...out, ""];
}

const run = Effect.fn("prQueue")(function* (options: PrQueueOptions) {
  const config = yield* Config;
  const gh = yield* Gh;
  const executor = yield* CommandExecutor;
  const now = yield* Clock.currentTimeMillis;
  const since = parseSince(options.since, now);

  if (since === undefined)
    return yield* new PrQueueError({
      message: `Unrecognised --since value: ${options.since}`,
    });

  const root = options.repo
    ? undefined
    : yield* executor
        .run("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() })
        .pipe(
          Effect.map((output) => output.trim()),
          Effect.orElseSucceed(() => undefined),
        );

  const managed = options.repo
    ? managedGitRepoForGitHub(config.gitConfig, options.repo)
    : root
      ? managedGitRepoForPath(config.gitConfig, root)
      : undefined;

  const repo =
    options.repo ??
    managed?.github ??
    (yield* gh
      .json(
        ["repo", "view", "--json", "nameWithOwner"],
        Schema.Struct({ nameWithOwner: Schema.String }),
        GH,
      )
      .pipe(
        Effect.map((result) => result.nameWithOwner),
        Effect.mapError(
          (error) =>
            new PrQueueError({
              message: `Could not resolve the repository; pass --repo: ${ghMessage(error)}`,
            }),
        ),
      ));

  const configured = options.search ?? managed?.reviewSearch ?? "";

  if (!configured && options.only !== "activity")
    return yield* new PrQueueError({
      message: `No review_search for ${repo} in private dot-git.yml; pass --search, or --only activity`,
    });

  const search = /(^|\s)repo:\S/.test(configured)
    ? configured
    : `repo:${repo} ${configured}`;

  const graphql = <S extends Schema.Top>(
    query: string,
    variables: Record<string, string | number | null>,
    schema: S,
  ) =>
    Api.json(
      {
        endpoint: "graphql",
        method: "POST",
        body: { query, variables },
        options: GH,
      },
      schema,
    );

  const fetchQueue = Effect.gen(function* () {
    const nodes: QueueNode[] = [];
    let cursor: string | null = null;
    let total = 0;

    do {
      const response: typeof QueueResponse.Type = yield* graphql(
        QUEUE_QUERY,
        {
          q: `${search} is:pr`,
          first: Math.min(50, options.limit - nodes.length),
          cursor,
        },
        QueueResponse,
      );

      total = response.data.search.issueCount;
      nodes.push(...response.data.search.nodes);
      cursor = response.data.search.pageInfo.hasNextPage
        ? response.data.search.pageInfo.endCursor
        : null;
    } while (cursor !== null && nodes.length < options.limit);

    return { total, nodes };
  }).pipe(Effect.withSpan("prQueue.fetchQueue"));

  const fetchActivity = Effect.fn("prQueue.fetchActivity")(function* (
    qualifier: string,
  ) {
    const items: ActivityItem[] = [];
    let cursor: string | null = null;
    let total = 0;

    do {
      const response: typeof ActivityResponse.Type = yield* graphql(
        ACTIVITY_QUERY,
        {
          q: `repo:${repo} is:pr ${qualifier}:>=${searchTime(since)}`,
          first: 50,
          cursor,
        },
        ActivityResponse,
      );

      total = response.data.search.issueCount;
      items.push(
        ...response.data.search.nodes.map(
          (node: ActivityNode): ActivityItem => ({
            number: node.number,
            title: node.title,
            url: node.url,
            author: author(node.author),
            state: node.state.toLowerCase(),
            createdAt: node.createdAt,
            at:
              qualifier === "created"
                ? node.createdAt
                : (node.mergedAt ?? node.closedAt ?? node.createdAt),
            ...(node.mergedBy && { mergedBy: author(node.mergedBy) }),
            additions: node.additions,
            deletions: node.deletions,
            changedFiles: node.changedFiles,
            labels: node.labels.nodes.map((label) => label.name),
          }),
        ),
      );
      cursor = response.data.search.pageInfo.hasNextPage
        ? response.data.search.pageInfo.endCursor
        : null;
    } while (cursor !== null && items.length < ACTIVITY_LIMIT);

    items.sort((a, b) => b.at.localeCompare(a.at));

    return { total, items } satisfies ActivityList;
  });

  const none = Effect.void;
  const wantQueue = options.only !== "activity";
  const wantActivity = options.only !== "queue";

  const [queue, openTotal, opened, merged, closed] = yield* Effect.all(
    [
      wantQueue ? fetchQueue : none,
      graphql(
        COUNT_QUERY,
        { q: `repo:${repo} is:pr is:open` },
        CountResponse,
      ).pipe(Effect.map((response) => response.data.search.issueCount)),
      wantActivity ? fetchActivity("created") : none,
      wantActivity ? fetchActivity("merged") : none,
      wantActivity ? fetchActivity("is:unmerged closed") : none,
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.mapError(
      (error) =>
        new PrQueueError({
          message: `GitHub search failed: ${ghMessage(error)}`,
        }),
    ),
  );

  const items = (queue?.nodes ?? [])
    .map((node) => classify(node, since))
    .sort(COMPARE[options.sort]);

  const activity =
    opened && merged && closed
      ? {
          opened,
          merged,
          closed,
          netOpenChange: opened.total - merged.total - closed.total,
        }
      : undefined;

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          repo,
          generatedAt: new Date(now).toISOString(),
          since: new Date(since).toISOString(),
          openTotal,
          ...(activity && { activity }),
          ...(queue && {
            queue: {
              search,
              sort: options.sort,
              total: queue.total,
              listed: items.length,
              items,
            },
          }),
        },
        null,
        2,
      )}\n`,
    );

    return;
  }

  const out = [`# Pull requests: ${repo}`, "", `${openTotal} open.`, ""];

  if (activity) {
    const net = activity.netOpenChange;

    out.push(
      `## Activity since ${new Date(since).toLocaleString()}`,
      "",
      `Net change in open pull requests: ${net >= 0 ? "+" : ""}${net}.`,
      "",
      ...renderActivity("Merged", activity.merged),
      ...renderActivity("Closed without merging", activity.closed),
      ...renderActivity("Opened", activity.opened),
    );
  }

  if (queue) {
    out.push(
      "## Review queue",
      "",
      `Search: \`${search}\``,
      "",
      `${queue.total} match${items.length < queue.total ? ` (showing ${items.length})` : ""}.`,
      "",
    );

    const header =
      "| PR | Author | Size | Updated | Checks | Reviews | Labels | Notes |";

    const divider = "|---|---|---|---|---|---|---|---|";

    if (options.sort === "effort")
      for (const group of ["small", "medium", "large", "notReady"] as const) {
        const grouped = items.filter((item) => item.group === group);

        out.push(`### ${GROUP_TITLES[group]} (${grouped.length})`, "");

        if (grouped.length === 0) {
          out.push("None.", "");
          continue;
        }

        out.push(header, divider, ...grouped.map(renderItem), "");
      }
    else
      out.push(
        `### By ${options.sort === "size" ? "size, smallest first" : `${options.sort}, newest first`}`,
        "",
        `| Group ${header}`,
        `|---${divider}`,
        ...items.map(
          (item) => `| ${GROUP_TITLES[item.group]} ${renderItem(item)}`,
        ),
        "",
      );

    out.push(
      `Groups: small is up to ${SMALL_LINES} changed lines, medium up to ${MEDIUM_LINES}; not ready means a failing check or changes requested. "new" and "updated" are relative to the activity window.`,
    );
  }

  process.stdout.write(`${out.join("\n")}\n`);
});

/**
 * List pull requests matching a repository's review search, grouped by review
 * effort, with opened, merged and closed activity since a point in time.
 */
export const prQueue = (options: PrQueueOptions) =>
  run(options).pipe(
    Effect.catchTag("PrQueueError", (error) =>
      Effect.sync(() => {
        console.error(`pr-queue: ${error.message}`);
        process.exitCode = 1;
      }),
    ),
  );
