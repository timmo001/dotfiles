import { PullRequest, Workflow, type GhError } from "@timmo001/effect-gh";
import { Clock, Duration, Effect, FileSystem, Option, Schema } from "effect";
import { dirname, join } from "node:path";
import { STATE_DIR, displayPath, expandHomePath } from "../lib/paths.js";
import { formatCause } from "../lib/schema.js";
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
  viewPullRequest,
  type PullRequestRef,
  type ReviewState,
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

const EXIT = { passed: 0, failed: 1, stopped: 3, timedOut: 124 } as const;

const workflowErrorMessage = (error: GhError | Workflow.InvalidOptions) =>
  error instanceof Workflow.InvalidOptions
    ? `invalid workflow options: ${formatCause(error.cause)}`
    : ghErrorMessage(error);

type Run = Workflow.Run;

type Job = Workflow.Job;

interface Target extends PullRequestRef {
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
    baseline: true,
    pending: [],
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
        Effect.succeed(`Log unavailable: ${workflowErrorMessage(error)}`),
      ),
    );

    yield* write(
      `\n### Failed: #${target.number} ${runLabel(run)} / ${job.name}\n\n${job.url}\n\n\`\`\`text\n${log}\n\`\`\`\n`,
    );

    if (options.stopOn.includes("failure")) stopReason ??= "failure";
  });

  const pollTarget = Effect.fn("prWatch.pollTarget")(function* (
    target: Target,
  ) {
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

      if (done || run.status === "in_progress") {
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
          isOpenThread(thread),
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
            Effect.catch((error) =>
              say(
                target,
                `[WARN] Poll failed, retrying: ${workflowErrorMessage(error)}`,
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

  yield* write("");

  for (const target of targets) {
    yield* write(`${renderReviews(target, target.reviews)}\n`);
  }

  const summary = targets.map((target) => {
    const openThreads = target.reviews.threads.filter(isOpenThread).length;

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

  yield* write(
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
        console.error(`pr watch: ${error.message}`);
        process.exitCode = EXIT.failed;
      }),
    ),
  );
