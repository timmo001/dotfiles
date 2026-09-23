import { Api, Gh, PullRequest, type GhError } from "@timmo001/effect-gh";
import { Clock, Duration, Effect, Option, Schema } from "effect";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATE_DIR, displayPath, expandHomePath } from "../lib/paths.js";

/** Early-stop triggers for {@link prWatch}. */
export type PrWatchStopOn = "failure" | "review";

/** Options for {@link prWatch}. */
export interface PrWatchOptions {
  /** Pull request numbers; empty means the current branch's pull request. */
  readonly prs: readonly number[];
  /** Repository slug passed to gh when the pull requests are not in the current repository. */
  readonly repo: string | undefined;
  /** Conditions that end the watch before every run has finished. */
  readonly stopOn: readonly PrWatchStopOn[];
  /** Overall watch deadline in milliseconds. */
  readonly timeout: number;
  /** Seconds between polls. */
  readonly interval: number;
  /** Trailing failed-log lines kept per job; 0 keeps the whole log. */
  readonly logLines: number;
  /** Report file path; defaults to a timestamped file under the dot state directory. */
  readonly output: string | undefined;
}

const GH = { timeout: "2 minutes" } as const;

const STABLE_POLLS = 2;

const BOT_REVIEW_GRACE_MS = 5 * 60 * 1000;

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

const EXIT = { passed: 0, failed: 1, stopped: 3, timedOut: 124 } as const;

const PullRequestInfo = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: Schema.String,
  headRefOid: Schema.String,
});

const Run = Schema.Struct({
  databaseId: Schema.Int,
  attempt: Schema.Int,
  name: Schema.String,
  workflowName: Schema.NullOr(Schema.String),
  event: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  url: Schema.String,
});

type Run = typeof Run.Type;

const Job = Schema.Struct({
  databaseId: Schema.Int,
  name: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  url: Schema.String,
  steps: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      conclusion: Schema.NullOr(Schema.String),
    }),
  ),
});

type Job = typeof Job.Type;

const Login = Schema.NullOr(Schema.Struct({ login: Schema.String }));

const Minimized = {
  isMinimized: Schema.Boolean,
  minimizedReason: Schema.NullOr(Schema.String),
};

const Review = Schema.Struct({
  id: Schema.String,
  state: Schema.String,
  submittedAt: Schema.NullOr(Schema.String),
  body: Schema.String,
  url: Schema.String,
  author: Login,
  commit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
  ...Minimized,
});

type Review = typeof Review.Type;

const Comment = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
  url: Schema.String,
  author: Login,
  pullRequestReview: Schema.NullOr(Schema.Struct({ id: Schema.String })),
  ...Minimized,
});

type Comment = typeof Comment.Type;

const Thread = Schema.Struct({
  id: Schema.String,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  path: Schema.String,
  line: Schema.NullOr(Schema.Int),
  originalLine: Schema.NullOr(Schema.Int),
  resolvedBy: Login,
  comments: Schema.Struct({ nodes: Schema.Array(Comment) }),
});

type Thread = typeof Thread.Type;

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
          nodes: Schema.Array(Thread),
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
        nodes {
          id isResolved isOutdated path line originalLine
          resolvedBy { login }
          comments(first: 100) {
            nodes {
              id body createdAt url isMinimized minimizedReason
              author { login }
              pullRequestReview { id }
            }
          }
        }
      }
    }
  }
}`;

interface ReviewState {
  readonly reviews: readonly Review[];
  readonly threads: readonly Thread[];
  readonly botRequests: readonly string[];
}

interface Target {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repo: string;
  readonly owner: string;
  readonly name: string;
  head: string;
  readonly runs: Map<number, string>;
  readonly jobs: Set<number>;
  readonly checks: Map<string, string>;
  readonly seenReviews: Set<string>;
  baseline: boolean;
  pending: string[];
  failures: number;
  reviews: ReviewState;
}

class PrWatchError extends Schema.TaggedError<PrWatchError>()("PrWatchError", {
  message: Schema.String,
}) {}

const author = (login: { readonly login: string } | null) =>
  login?.login ?? "ghost";

const quote = (body: string) =>
  body
    .trim()
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");

const short = (sha: string) => sha.slice(0, 9);

const time = (millis: number) => new Date(millis).toISOString().slice(11, 19);

const runLabel = (run: Run) =>
  run.workflowName && run.workflowName !== run.name
    ? `${run.workflowName} / ${run.name}`
    : run.name;

/** Keep only the newest run per workflow and event; older same-commit runs are superseded. */
function latestRuns(runs: readonly Run[]): Run[] {
  const latest = new Map<string, Run>();

  for (const run of runs) {
    const key = `${run.workflowName ?? run.name}\u0000${run.event}`;
    const current = latest.get(key);

    if (!current || run.databaseId > current.databaseId) latest.set(key, run);
  }

  return [...latest.values()].sort((a, b) => a.databaseId - b.databaseId);
}

/** Strip gh's `job<TAB>step<TAB>` prefix and group failed-log lines by step. */
function formatFailedLog(raw: string, limit: number): string {
  const lines: string[] = [];
  let step = "";

  for (const line of raw.split("\n")) {
    const [, stepName = "", rest = line] = line.split("\t");

    if (stepName !== step) {
      step = stepName;
      lines.push(`--- ${step}`);
    }

    lines.push(rest.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ""));
  }

  const kept = limit > 0 ? lines.slice(-limit) : lines;
  const dropped = lines.length - kept.length;

  return `${dropped > 0 ? `[${dropped} earlier lines omitted; rerun with --log-lines 0 for the full log]\n` : ""}${kept.join("\n").trimEnd()}`;
}

function threadStatus(thread: Thread): string | undefined {
  const [first] = thread.comments.nodes;

  if (first?.isMinimized)
    return `minimized as ${first.minimizedReason ?? "unknown"}`;

  if (thread.isResolved) return `resolved by ${author(thread.resolvedBy)}`;
}

function renderComment(comment: Comment): string {
  const hidden = comment.isMinimized
    ? ` (minimized as ${comment.minimizedReason ?? "unknown"})`
    : "";

  return `**${author(comment.author)}** at ${comment.createdAt}${hidden} (${comment.url}):\n\n${quote(comment.body)}\n`;
}

function renderReviews(target: Target): string {
  const { reviews, threads, botRequests } = target.reviews;

  const submitted = new Map(
    reviews.map((review) => [review.id, review.submittedAt ?? ""]),
  );

  const threadTime = (thread: Thread) => {
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

  const open = ordered.filter((thread) => threadStatus(thread) === undefined);
  const dismissed = ordered.filter((thread) => threadStatus(thread));

  const location = (thread: Thread) =>
    `${thread.path}:${thread.line ?? thread.originalLine ?? "?"}${thread.isOutdated ? " (outdated)" : ""}`;

  const out: string[] = [
    `## Reviews for #${target.number}: ${target.title}`,
    "",
    `Head ${short(target.head)}. ${target.url}`,
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
    const reviewer = author(review.author);
    const superseded = latestByAuthor.has(reviewer);

    latestByAuthor.add(reviewer);
    const older = commit && commit !== target.head ? " (older commit)" : "";

    out.push(
      `#### ${author(review.author)} ${review.state} at ${review.submittedAt ?? "?"} on ${commit ? short(commit) : "?"}${older}`,
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
    out.push(`#### ${location(thread)} [${thread.id}]`, "");
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
      `#### ${location(thread)} [${thread.id}] ${threadStatus(thread)}`,
      "",
      `Started by ${author(first?.author ?? null)}: ${first?.url ?? ""}`,
      "",
    );

    if (replies.length === 0) out.push("No reply.", "");
    else out.push(...replies.map(renderComment));
  }

  return out.join("\n");
}

const watchPullRequests = Effect.fn("prWatch")(function* (
  options: PrWatchOptions,
) {
  const gh = yield* Gh;
  const repoArgs = options.repo ? ["--repo", options.repo] : [];

  const viewPr = (selector: number | undefined) =>
    gh.json(
      [
        "pr",
        "view",
        ...repoArgs,
        "--json",
        "number,title,url,state,headRefOid",
        ...(selector === undefined ? [] : ["--", String(selector)]),
      ],
      PullRequestInfo,
      GH,
    );

  const resolved = yield* Effect.forEach(
    options.prs.length > 0 ? options.prs : [undefined],
    viewPr,
  ).pipe(
    Effect.mapError(
      (error) =>
        new PrWatchError({
          message: `Could not resolve the pull request: ${"stderr" in error ? error.stderr.trim() : error._tag}`,
        }),
    ),
  );

  const targets: Target[] = [];

  for (const pr of resolved) {
    const match = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(pr.url);

    if (!match?.[1] || !match[2])
      return yield* new PrWatchError({
        message: `Unrecognised pull request URL: ${pr.url}`,
      });

    targets.push({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      owner: match[1],
      name: match[2],
      repo: `${match[1]}/${match[2]}`,
      head: pr.headRefOid,
      runs: new Map(),
      jobs: new Set(),
      checks: new Map(),
      seenReviews: new Set(),
      baseline: true,
      pending: [],
      failures: 0,
      reviews: { reviews: [], threads: [], botRequests: [] },
    });
  }

  const started = yield* Clock.currentTimeMillis;
  const [firstTarget] = targets;

  const report = expandHomePath(
    options.output ??
      join(
        STATE_DIR,
        "dot",
        "pr-watch",
        `${firstTarget?.owner}-${firstTarget?.name}-${targets.map((target) => target.number).join("-")}-${new Date(started).toISOString().replace(/[:.]/g, "-")}.md`,
      ),
  );

  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(
    report,
    `# PR watch\n\nStarted ${new Date(started).toISOString()}\n\n`,
  );

  const write = (text: string) => appendFileSync(report, `${text}\n`);

  const say = Effect.fn("prWatch.say")(function* (
    target: Target | undefined,
    message: string,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const line = `[${time(now)}]${target ? ` #${target.number}` : ""} ${message}`;
    process.stdout.write(`${line}\n`);
    write(`- ${line}`);
  });

  yield* say(undefined, `Report: ${displayPath(report)}`);

  for (const target of targets)
    yield* say(
      target,
      `${target.title} (head ${short(target.head)}) ${target.url}`,
    );

  let stopReason: PrWatchStopOn | undefined;

  const fetchReviews = Effect.fn("prWatch.fetchReviews")(function* (
    target: Target,
  ) {
    const threads: Thread[] = [];
    let cursor: string | null = null;
    let reviews: readonly Review[] = [];
    let botRequests: string[] = [];

    do {
      const response: typeof ReviewResponse.Type = yield* Api.json(
        {
          endpoint: "graphql",
          method: "POST",
          body: {
            query: REVIEW_QUERY,
            variables: {
              owner: target.owner,
              name: target.name,
              number: target.number,
              cursor,
            },
          },
          options: GH,
        },
        ReviewResponse,
      );

      const pr = response.data.repository.pullRequest;
      threads.push(...pr.reviewThreads.nodes);

      if (cursor === null) {
        reviews = pr.reviews.nodes;
        botRequests = pr.reviewRequests.nodes.flatMap((node) =>
          node.requestedReviewer?.__typename === "Bot" &&
          node.requestedReviewer.login
            ? [node.requestedReviewer.login]
            : [],
        );
      }

      cursor = pr.reviewThreads.pageInfo.hasNextPage
        ? pr.reviewThreads.pageInfo.endCursor
        : null;
    } while (cursor !== null);

    return { reviews, threads, botRequests } satisfies ReviewState;
  });

  const reportFailedJob = Effect.fn("prWatch.reportFailedJob")(function* (
    target: Target,
    run: Run,
    job: Job,
  ) {
    const steps = job.steps
      .filter((step) => step.conclusion && FAILED.has(step.conclusion))
      .map((step) => step.name);

    target.failures++;
    yield* say(
      target,
      `FAILED ${runLabel(run)}: ${job.name}${steps.length > 0 ? ` (steps: ${steps.join(", ")})` : ""}`,
    );

    const log = yield* gh
      .execute(
        [
          "run",
          "view",
          String(run.databaseId),
          "--repo",
          target.repo,
          "--job",
          String(job.databaseId),
          "--log-failed",
        ],
        GH,
      )
      .pipe(
        Effect.map((output) =>
          formatFailedLog(output.stdout, options.logLines),
        ),
        Effect.catch((error: GhError) =>
          Effect.succeed(
            `Log unavailable: ${"stderr" in error ? error.stderr.trim() : error._tag}`,
          ),
        ),
      );

    write(
      `\n### Failed: #${target.number} ${runLabel(run)} / ${job.name}\n\n${job.url}\n\n\`\`\`text\n${log}\n\`\`\`\n`,
    );

    if (options.stopOn.includes("failure")) stopReason ??= "failure";
  });

  const pollTarget = Effect.fn("prWatch.pollTarget")(function* (
    target: Target,
  ) {
    const pr = yield* viewPr(target.number);

    if (pr.headRefOid !== target.head) {
      yield* say(
        target,
        `Head moved ${short(target.head)} -> ${short(pr.headRefOid)}; watching the new commit`,
      );
      target.head = pr.headRefOid;
      target.runs.clear();
      target.jobs.clear();
      target.checks.clear();
    }

    const runs = latestRuns(
      yield* gh.json(
        [
          "run",
          "list",
          "--repo",
          target.repo,
          "--commit",
          target.head,
          "--limit",
          "100",
          "--json",
          "databaseId,attempt,name,workflowName,event,status,conclusion,url",
        ],
        Schema.Array(Run),
        GH,
      ),
    );

    const pending: string[] = [];
    let alreadyDone = 0;

    for (const run of runs) {
      const seen = target.runs.get(run.databaseId);
      const done = run.status === "completed";
      const key = `${run.attempt}:${done ? "done" : "active"}`;

      if (!done) pending.push(runLabel(run));

      if (seen === `${run.attempt}:done`) continue;

      if (!done && seen === undefined)
        yield* say(target, `Started ${runLabel(run)} ${run.url}`);
      else if (!done && seen !== key)
        yield* say(target, `Re-run ${runLabel(run)} attempt ${run.attempt}`);

      target.runs.set(run.databaseId, key);

      if (done || run.status === "in_progress") {
        const { jobs } = yield* gh.json(
          [
            "run",
            "view",
            String(run.databaseId),
            "--repo",
            target.repo,
            "--json",
            "jobs",
          ],
          Schema.Struct({ jobs: Schema.Array(Job) }),
          GH,
        );

        for (const job of jobs) {
          if (
            job.status !== "completed" ||
            !job.conclusion ||
            !FAILED.has(job.conclusion) ||
            target.jobs.has(job.databaseId)
          )
            continue;
          target.jobs.add(job.databaseId);
          yield* reportFailedJob(target, run, job);
        }
      }

      if (done && target.baseline && !FAILED.has(run.conclusion ?? ""))
        alreadyDone++;
      else if (done)
        yield* say(
          target,
          `Finished ${runLabel(run)}: ${run.conclusion || "unknown"}`,
        );
    }

    const { checks } = yield* PullRequest.checks(target.number, {
      repository: target.repo,
      ...GH,
    }).pipe(
      Effect.catchTag("GhCommandError", () => Effect.succeed({ checks: [] })),
    );

    for (const check of checks) {
      if (check.workflow) continue;

      if (check.bucket === "pending") {
        pending.push(check.name);
        continue;
      }

      if (target.checks.get(check.name) === check.bucket) continue;
      target.checks.set(check.name, check.bucket);

      if (target.baseline && check.bucket !== "fail") alreadyDone++;
      else
        yield* say(target, `Check ${check.name}: ${check.state.toLowerCase()}`);

      if (check.bucket === "fail") {
        target.failures++;
        write(
          `\n### Failed check: #${target.number} ${check.name}\n\n${check.link ?? ""}\n`,
        );

        if (options.stopOn.includes("failure")) stopReason ??= "failure";
      }
    }

    target.reviews = yield* fetchReviews(target);

    for (const review of target.reviews.reviews) {
      if (review.state === "PENDING" || target.seenReviews.has(review.id))
        continue;
      target.seenReviews.add(review.id);

      if (target.baseline) continue;

      const open = target.reviews.threads.filter(
        (thread) =>
          thread.comments.nodes[0]?.pullRequestReview?.id === review.id &&
          threadStatus(thread) === undefined,
      ).length;

      yield* say(
        target,
        `Review ${review.state.toLowerCase()} by ${author(review.author)}: ${open} open thread${open === 1 ? "" : "s"}`,
      );

      if (options.stopOn.includes("review") && open > 0)
        stopReason ??= "review";
    }

    if (alreadyDone > 0)
      yield* say(target, `${alreadyDone} already finished without failing`);

    target.baseline = false;
    target.pending = pending;
  });

  const watch = Effect.gen(function* () {
    let stablePolls = 0;
    let settledAt: number | undefined;

    for (;;) {
      yield* Effect.forEach(
        targets,
        (target) =>
          pollTarget(target).pipe(
            Effect.catch((error: GhError) =>
              say(
                target,
                `[WARN] Poll failed, retrying: ${"stderr" in error ? error.stderr.trim() : error._tag}`,
              ),
            ),
          ),
        { concurrency: "unbounded", discard: true },
      );

      if (stopReason) return;

      const now = yield* Clock.currentTimeMillis;

      const runsSettled = targets.every(
        (target) => target.pending.length === 0,
      );

      settledAt = runsSettled ? (settledAt ?? now) : undefined;

      const waitingForBots =
        settledAt !== undefined &&
        now - settledAt < BOT_REVIEW_GRACE_MS &&
        targets.some((target) => target.reviews.botRequests.length > 0);

      stablePolls = runsSettled && !waitingForBots ? stablePolls + 1 : 0;

      if (stablePolls >= STABLE_POLLS) return;

      yield* Effect.sleep(Duration.seconds(options.interval));
    }
  }).pipe(Effect.withSpan("prWatch.watch"));

  const completed = yield* watch.pipe(
    Effect.timeoutOption(Duration.millis(options.timeout)),
  );

  const timedOut = Option.isNone(completed);
  const failures = targets.reduce((sum, target) => sum + target.failures, 0);

  write("");

  for (const target of targets) write(`${renderReviews(target)}\n`);

  const summary = targets.map((target) => {
    const openThreads = target.reviews.threads.filter(
      (thread) => threadStatus(thread) === undefined,
    ).length;

    const waiting = [
      ...target.pending,
      ...target.reviews.botRequests.map((login) => `review from ${login}`),
    ];

    return `#${target.number}: ${target.failures} failed, ${openThreads} open review thread${openThreads === 1 ? "" : "s"}${waiting.length > 0 ? `, still pending: ${waiting.join(", ")}` : ""}`;
  });

  const outcome = timedOut
    ? "Timed out"
    : stopReason === "failure"
      ? "Stopped early on a failure"
      : stopReason === "review"
        ? "Stopped early on a new review"
        : failures > 0
          ? "Finished with failures"
          : "Finished, all passed";

  write(
    `## Summary\n\n${outcome}\n\n${summary.map((line) => `- ${line}`).join("\n")}\n`,
  );
  yield* say(undefined, outcome);

  for (const line of summary) process.stdout.write(`  ${line}\n`);
  process.stdout.write(`Full report: ${displayPath(report)}\n`);

  const stillPending = targets.some(
    (target) =>
      target.pending.length > 0 || target.reviews.botRequests.length > 0,
  );

  process.exitCode = timedOut
    ? EXIT.timedOut
    : stopReason && stillPending
      ? EXIT.stopped
      : failures > 0
        ? EXIT.failed
        : EXIT.passed;
});

/**
 * Watch pull request workflow runs, external checks and reviews until they
 * settle, streaming compact progress to stdout and full detail to a report.
 */
export const prWatch = (options: PrWatchOptions) =>
  watchPullRequests(options).pipe(
    Effect.catchTag("PrWatchError", (error) =>
      Effect.sync(() => {
        console.error(`pr-watch: ${error.message}`);
        process.exitCode = EXIT.failed;
      }),
    ),
  );
