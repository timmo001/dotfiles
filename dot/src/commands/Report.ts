import { Clock, Console, Effect } from "effect";
import { join } from "node:path";
import { workersAiFor } from "../lib/decisionModel.js";
import { acquireFileLock } from "../lib/fileLock.js";
import { isWorkTime } from "../lib/workTime.js";
import { readInboxThread, sendInboxMessage } from "../lib/inboxClient.js";
import { displayPath, expandHomePath } from "../lib/paths.js";
import { OutputLog } from "../services/OutputLog.js";
import {
  checkoutKey,
  ensureCheckout,
  type Checkout,
} from "../report/checkout.js";
import { runChecksSection } from "../report/checks.js";
import { runCodeSection } from "../report/code.js";
import { listReports, readReportConfig } from "../report/config.js";
import { runDependenciesSection } from "../report/dependencies.js";
import { runGithubSection } from "../report/github.js";
import { headline, renderHtml, renderMarkdown } from "../report/render.js";
import type { GithubResult, SectionResult } from "../report/result.js";
import {
  compareRuns,
  readLastRun,
  reportStateDir,
  sectionSnapshot,
  writeLastRun,
  writeRunPage,
} from "../report/state.js";
import { summarise } from "../report/summary.js";

/** How far back `{since}` reaches on a report's first run. */
const FIRST_RUN_DAYS = 7;

/** Exit status of a run skipped outside work time; services.d can map it to `skipped`. */
const SKIPPED_EXIT = 3;

/** Pull request numbers by changed path, from the GitHub sections tagging `codeId`. */
function pullRequestsByPath(
  github: readonly GithubResult[],
  codeId: string,
): Map<string, number[]> {
  const byPath = new Map<string, number[]>();

  for (const result of github)
    if (result.section.files_for === codeId)
      for (const item of result.items)
        for (const path of item.files)
          byPath.set(path, [...(byPath.get(path) ?? []), item.number]);

  return byPath;
}

/**
 * The last report's message id when its question is still open, so the new
 * report can withdraw it; empty once it's answered or the thread is resolved.
 */
const openQuestionOf = Effect.fn("report.openQuestion")(function* (
  projectPath: string,
  message: { readonly threadId: string; readonly messageId: string },
) {
  const thread = yield* readInboxThread(projectPath, message.threadId);

  const open =
    thread.resolved_at === null &&
    (thread.messages
      .find((entry) => entry.id === message.messageId)
      ?.questions?.some(
        (question) => question.state === "open" || question.state === "picked",
      ) ??
      false);

  return open ? [message.messageId] : [];
});

/** Run a report's sections, compare with the last run, then post it or print it. */
const run = Effect.fn("report.run")(function* (options: {
  readonly name: string;
  readonly dryRun: boolean;
}) {
  const output = yield* OutputLog;
  const config = yield* readReportConfig(options.name);
  const stateDir = reportStateDir(config.name);

  // A dry run is always a deliberate check, so only real runs wait for work time.
  if (
    config.workTimeOnly &&
    !options.dryRun &&
    !(yield* isWorkTime((message) => output.info(message)))
  ) {
    yield* Console.log("[RESULT] Skipped outside work time");

    return yield* Effect.sync(() => {
      process.exitCode = SKIPPED_EXIT;
    });
  }

  yield* acquireFileLock(join(stateDir, "run.lock"), { wait: "20 minutes" });

  const last = yield* readLastRun(config.name);
  const nowMs = yield* Clock.currentTimeMillis;
  const now = new Date(nowMs).toISOString();
  const date = now.slice(0, 10);

  const since =
    last?.at ??
    new Date(nowMs - FIRST_RUN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const repositories = new Map(
    config.sections.flatMap((section) =>
      section.type === "github" || section.type === "dependencies"
        ? []
        : [
            [
              checkoutKey(section.repository, section.branch),
              [section.repository, section.branch] as const,
            ] as const,
          ],
    ),
  );

  const checkouts = new Map<string, Checkout>(
    yield* Effect.forEach([...repositories], ([key, [repository, branch]]) =>
      output
        .withSpinner(
          `Updating ${repository}@${branch}`,
          ensureCheckout(repository, branch),
        )
        .pipe(Effect.map((checkout) => [key, checkout] as const)),
    ),
  );

  const workersAi = config.decisionModel
    ? yield* workersAiFor(config.decisionModel)
    : undefined;

  const github = yield* Effect.forEach(
    config.sections.filter((section) => section.type === "github"),
    (section) =>
      output.withSpinner(
        `Searching GitHub for ${section.title}`,
        runGithubSection(section, {
          since,
          decisionModel: config.decisionModel,
          workersAi,
        }),
      ),
  );

  const githubById = new Map(
    github.map((result) => [result.section.id, result]),
  );

  // Both maps were built from these same sections, so a miss is a bug.
  const found = <A>(value: A | undefined, what: string) =>
    value === undefined
      ? Effect.die(new Error(`report ${config.name}: no ${what}`))
      : Effect.succeed(value);

  const scanned = yield* Effect.forEach(config.sections, (section) =>
    Effect.gen(function* () {
      if (section.type === "dependencies") return undefined;

      if (section.type === "github")
        return yield* found(
          githubById.get(section.id),
          `result for ${section.id}`,
        );

      const checkout = yield* found(
        checkouts.get(checkoutKey(section.repository, section.branch)),
        `checkout for ${section.id}`,
      );

      return section.type === "code"
        ? yield* output.withSpinner(
            `Scanning ${section.title}`,
            runCodeSection(
              section,
              checkout,
              pullRequestsByPath(github, section.id),
            ),
          )
        : yield* runChecksSection(section, checkout);
    }),
  );

  const codeById = new Map(
    scanned.flatMap((result) =>
      result?.type === "code" ? [[result.section.id, result] as const] : [],
    ),
  );

  // Dependencies read their code section's files, so they run once those are scanned.
  const results = yield* Effect.forEach(config.sections, (section, index) =>
    Effect.gen(function* () {
      if (section.type !== "dependencies")
        return yield* found(scanned[index], `result for ${section.id}`);

      const code = yield* found(
        codeById.get(section.of),
        `code section ${section.of}`,
      );

      const result: SectionResult = yield* output.withSpinner(
        `Tracing ${section.title}`,
        runDependenciesSection(section, code),
      );

      return result;
    }),
  );

  const snapshot = {
    at: now,
    sections: Object.fromEntries(
      results.map((result) => [result.section.id, sectionSnapshot(result)]),
    ),
  };

  const base = {
    config,
    date,
    results,
    changes: compareRuns(last, snapshot),
  };

  const summary = yield* summarise(config, base, stateDir);
  const report = { ...base, summary };
  const html = renderHtml(report);

  if (options.dryRun) {
    const page = yield* writeRunPage(config.name, "dry-run.html", html);

    yield* Console.log(renderMarkdown(report, undefined));
    yield* output.info(`Page written to ${displayPath(page)}`);

    return;
  }

  const page = yield* writeRunPage(config.name, `${date}.html`, html);
  const projectPath = expandHomePath(config.inbox.project);

  const supersedes = last?.message
    ? yield* openQuestionOf(projectPath, last.message).pipe(
        Effect.catch((error) =>
          output
            .warn(`Could not read the last report's question: ${error.message}`)
            .pipe(Effect.as([])),
        ),
      )
    : [];

  const sent = yield* sendInboxMessage({
    projectPath,
    thread: config.inbox.thread,
    subject: `${config.title} ${date}`,
    body: renderMarkdown(report, page),
    idempotencyKey: `report-${config.name}-${now}`,
    attachments: [page],
    supersedes,
  });

  yield* writeLastRun(config.name, {
    ...snapshot,
    message: { threadId: sent.thread_id, messageId: sent.message_id },
  });

  yield* output.success(
    `Posted ${config.title} to the "${config.inbox.thread}" Inbox thread`,
  );
  yield* Console.log(`[RESULT] ${headline(report)}`);
}, Effect.scoped);

const reportFailure =
  (command: string) => (error: { readonly message: string }) =>
    Effect.sync(() => {
      console.error(`report ${command}: ${error.message}`);
      process.exitCode = 1;
    });

/** `dot report run`: run a report and post it to the Inbox. */
export const reportRun = (options: {
  readonly name: string;
  readonly dryRun: boolean;
}) => run(options).pipe(Effect.catch(reportFailure("run")));

/** `dot report list`: show every report file and whether it's valid. */
export const reportList = listReports.pipe(
  Effect.flatMap((reports) =>
    Effect.gen(function* () {
      const output = yield* OutputLog;

      if (reports.length === 0)
        return yield* output.info("No report files in ~/.config/dot/reports");

      for (const report of reports)
        yield* report.error
          ? output.warn(`${report.name}: ${report.error}`)
          : Console.log(`${report.name}\t${report.title}`);
    }),
  ),
  Effect.withSpan("report.listCommand"),
  Effect.catch(reportFailure("list")),
);
