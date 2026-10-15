import { PullRequest, Workflow } from "@timmo001/effect-gh";
import {
  Clock,
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Option,
  Schema,
} from "effect";
import { dirname, join } from "node:path";
import { STATE_DIR, displayPath, expandHomePath } from "../lib/paths.js";
import {
  GH_OPTIONS as GH,
  authorLogin as author,
  fetchReviews,
  ghErrorMessage,
  isOpenThread,
  pullRequestLookupMessage,
  renderReviews,
  resolvePullRequest,
  shortSha as short,
  threadLocation,
  viewPullRequest,
  type PullRequestRef,
  type Review,
  type ReviewState,
  type ReviewThread,
} from "../lib/pullRequestReviews.js";

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

const STABLE_POLLS = 2;

const BOT_REVIEW_GRACE_MS = 5 * 60 * 1000;

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

const PASSED = new Set(["success", "skipped", "neutral"]);

const EXIT = { passed: 0, failed: 1, stopped: 3, timedOut: 124 } as const;

type Run = Workflow.Run;

type Job = Workflow.Job;

interface Target extends PullRequestRef {
  head: string;
  readonly runs: Map<number, string>;
  readonly jobs: Set<number>;
  readonly checks: Map<string, string>;
  readonly seenReviews: Set<string>;
  readonly seenThreads: Set<string>;
  baseline: boolean;
  reviewsRead: boolean;
  pending: string[];
  failures: number;
  reviews: ReviewState;
}

class PrWatchError extends Schema.TaggedError<PrWatchError>()("PrWatchError", {
  message: Schema.String,
}) {}

const time = (millis: number) => new Date(millis).toISOString().slice(11, 19);

const runLabel = (run: Run) =>
  run.workflowName && run.workflowName !== run.name
    ? `${run.workflowName} / ${run.name}`
    : run.name;

const DECISIONS = new Set(["APPROVED", "CHANGES_REQUESTED"]);

/** Each author's latest approval or change request, oldest first. */
function latestDecisions(reviews: readonly Review[]): Review[] {
  const latest = new Map<string, Review>();

  for (const review of reviews) {
    if (!review.submittedAt) continue;

    const key = author(review.author);
    const current = latest.get(key);

    if (!current?.submittedAt || review.submittedAt > current.submittedAt)
      latest.set(key, review);
  }

  return [...latest.values()]
    .filter((review) => DECISIONS.has(review.state))
    .sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
}

const threadLine = (thread: ReviewThread) => {
  const [first] = thread.comments.nodes;

  return `${threadLocation(thread)} by ${author(first?.author ?? null)}${first ? ` ${first.url}` : ""}`;
};

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

const watchPullRequests = Effect.fn("prWatch")(function* (
  options: PrWatchOptions,
) {
  const resolved = yield* Effect.forEach(
    options.prs.length > 0 ? options.prs : [undefined],
    (selector) => resolvePullRequest(selector, options.repo),
  ).pipe(
    Effect.mapError(
      (error) => new PrWatchError({ message: pullRequestLookupMessage(error) }),
    ),
  );

  const targets: Target[] = resolved.map((pr) => ({
    ...pr,
    runs: new Map(),
    jobs: new Set(),
    checks: new Map(),
    seenReviews: new Set(),
    seenThreads: new Set(),
    baseline: true,
    reviewsRead: false,
    pending: ["CI not checked yet"],
    failures: 0,
    reviews: { reviews: [], threads: [], botRequests: [] },
  }));

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

  const fs = yield* FileSystem.FileSystem;

  yield* fs
    .makeDirectory(dirname(report), { recursive: true })
    .pipe(Effect.orDie);
  yield* fs
    .writeFileString(
      report,
      `# PR watch\n\nStarted ${new Date(started).toISOString()}\n\n`,
    )
    .pipe(Effect.orDie);

  const write = (text: string) =>
    fs.writeFileString(report, `${text}\n`, { flag: "a" }).pipe(Effect.orDie);

  const say = Effect.fn("prWatch.say")(function* (
    target: Target | undefined,
    message: string,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const line = `[${time(now)}]${target ? ` #${target.number}` : ""} ${message}`;
    process.stdout.write(`${line}\n`);
    yield* write(`- ${line}`);
  });

  yield* say(undefined, `Report: ${displayPath(report)}`);

  for (const target of targets)
    yield* say(
      target,
      `${target.title} (head ${short(target.head)}) ${target.url}`,
    );

  let stopReason: PrWatchStopOn | undefined;
  const stopped = yield* Deferred.make<void>();

  const stop = (reason: PrWatchStopOn) =>
    Effect.suspend(() => {
      stopReason ??= reason;

      return Deferred.succeed(stopped, undefined);
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

    const log = yield* Workflow.logs(
      {
        repo: target.repo,
        runId: run.databaseId,
        job: job.databaseId,
        failedOnly: true,
      },
      GH,
    ).pipe(
      Effect.map((output) => formatFailedLog(output, options.logLines)),
      Effect.catch((error) =>
        Effect.succeed(`Log unavailable: ${ghErrorMessage(error)}`),
      ),
    );

    yield* write(
      `\n### Failed: #${target.number} ${runLabel(run)} / ${job.name}\n\n${job.url}\n\n\`\`\`text\n${log}\n\`\`\`\n`,
    );

    if (options.stopOn.includes("failure")) yield* stop("failure");
  });

  const pollCi = Effect.fn("prWatch.pollCi")(function* (target: Target) {
    const pr = yield* viewPullRequest(target.number, options.repo);

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
      yield* Workflow.list(
        { repo: target.repo, commit: target.head, limit: 100 },
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

      if (
        run.status === "in_progress" ||
        (done && !PASSED.has(run.conclusion ?? ""))
      ) {
        const jobs = yield* Workflow.jobs(
          { repo: target.repo, runId: run.databaseId },
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
        yield* write(
          `\n### Failed check: #${target.number} ${check.name}\n\n${check.link ?? ""}\n`,
        );

        if (options.stopOn.includes("failure")) yield* stop("failure");
      }
    }

    if (alreadyDone > 0)
      yield* say(target, `${alreadyDone} already finished without failing`);

    target.pending = pending;
  });

  const pollReviews = Effect.fn("prWatch.pollReviews")(function* (
    target: Target,
  ) {
    target.reviews = yield* fetchReviews(target);
    target.reviewsRead = true;

    for (const review of target.reviews.reviews) {
      if (review.state === "PENDING" || target.seenReviews.has(review.id))
        continue;
      target.seenReviews.add(review.id);

      if (target.baseline) continue;

      const open = target.reviews.threads.filter(
        (thread) =>
          thread.comments.nodes[0]?.pullRequestReview?.id === review.id &&
          isOpenThread(thread),
      ).length;

      yield* say(
        target,
        `Review ${review.state.toLowerCase()} by ${author(review.author)}: ${open} open thread${open === 1 ? "" : "s"}`,
      );

      if (options.stopOn.includes("review") && open > 0) yield* stop("review");
    }

    if (target.baseline) {
      for (const review of latestDecisions(target.reviews.reviews))
        yield* say(
          target,
          `Review ${review.state.toLowerCase()} by ${author(review.author)}${review.commit?.oid === target.head ? "" : " (older commit)"} ${review.url}`,
        );

      if (target.reviews.botRequests.length > 0)
        yield* say(
          target,
          `Waiting for review from ${target.reviews.botRequests.join(", ")}`,
        );
    }

    for (const thread of target.reviews.threads) {
      if (!isOpenThread(thread) || target.seenThreads.has(thread.id)) continue;
      target.seenThreads.add(thread.id);
      yield* say(target, `Open thread ${threadLine(thread)}`);
    }

    // Threads that predate the watch only stop it while nobody has answered
    // them, so a watch started after pushing fixes still follows CI.
    if (
      target.baseline &&
      options.stopOn.includes("review") &&
      target.reviews.threads.some(
        (thread) =>
          isOpenThread(thread) &&
          !thread.isOutdated &&
          thread.comments.totalCount === 1,
      )
    )
      yield* stop("review");
  });

  const pollTarget = (target: Target) =>
    Effect.forEach(
      [pollCi, pollReviews],
      (poll) =>
        poll(target).pipe(
          Effect.catch((error) =>
            say(
              target,
              `[WARN] Poll failed, retrying: ${ghErrorMessage(error)}`,
            ),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          target.baseline = false;
        }),
      ),
    );

  const watch = Effect.gen(function* () {
    let stablePolls = 0;
    let settledAt: number | undefined;

    for (;;) {
      yield* Effect.forEach(targets, pollTarget, {
        concurrency: "unbounded",
        discard: true,
      });

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
    Effect.raceFirst(Deferred.await(stopped)),
    Effect.timeoutOption(Duration.millis(options.timeout)),
  );

  const timedOut = Option.isNone(completed);
  const failures = targets.reduce((sum, target) => sum + target.failures, 0);

  yield* write("");

  for (const target of targets) {
    yield* write(`${renderReviews(target, target.reviews)}\n`);
  }

  const summarise = (target: Target) => {
    const openThreads = target.reviews.threads.filter(isOpenThread).length;

    const waiting = [
      ...target.pending,
      ...target.reviews.botRequests.map((login) => `review from ${login}`),
    ];

    return `#${target.number}: ${target.failures} failed, ${target.reviewsRead ? `${openThreads} open review thread${openThreads === 1 ? "" : "s"}` : "reviews not checked yet"}${waiting.length > 0 ? `, still pending: ${waiting.join(", ")}` : ""}`;
  };

  const openThreads = targets.reduce(
    (sum, target) => sum + target.reviews.threads.filter(isOpenThread).length,
    0,
  );

  const outcome = timedOut
    ? "Timed out"
    : stopReason === "failure"
      ? "Stopped early on a failure"
      : stopReason === "review"
        ? "Stopped early on open review threads"
        : failures > 0
          ? "Finished with failures"
          : openThreads > 0
            ? `Finished, CI passed with ${openThreads} open review thread${openThreads === 1 ? "" : "s"}`
            : "Finished, all passed";

  yield* write(
    `## Summary\n\n${outcome}\n\n${targets.map((target) => `- ${summarise(target)}`).join("\n")}\n`,
  );
  yield* say(undefined, outcome);

  for (const target of targets) {
    process.stdout.write(`  ${summarise(target)}\n`);

    for (const thread of target.reviews.threads)
      if (isOpenThread(thread))
        process.stdout.write(`    Open thread ${threadLine(thread)}\n`);
  }

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
        console.error(`pr watch: ${error.message}`);
        process.exitCode = EXIT.failed;
      }),
    ),
  );
