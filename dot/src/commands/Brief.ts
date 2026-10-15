import { Clock, Effect } from "effect";
import { hostname } from "node:os";
import { join } from "node:path";
import { acquireFileLock } from "../lib/fileLock.js";
import { isWorkTime } from "../lib/workTime.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { collectBrief } from "../brief/collect.js";
import { readBriefConfig } from "../brief/config.js";
import { briefFollowUp as followUp } from "../brief/followUp.js";
import { readBriefThread, sendBrief } from "../brief/inbox.js";
import { SECTIONS, scoreBrief, type ScoredItem } from "../brief/score.js";
import {
  briefStateDir,
  readLastReport,
  readResolutions,
  writeLastReport,
  writeResolutions,
  type LastReport,
} from "../brief/state.js";

/** Reports kept so notes can still refer to their `B` numbers. */
const KEPT_REPORTS = 7;

/** Resolutions of items that dropped off are forgotten after this long. */
const DONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const KIND_LABELS: Record<ScoredItem["kind"], string> = {
  pr: "PR",
  issue: "Issue",
  notification: "Notification",
  ci: "CI",
};

const DISMISS_PROMPT =
  "Which of these can drop off until something new happens?";

const words = (value: string) => value.replaceAll("_", " ");

const escapeLink = (text: string) => text.replace(/([[\]\\])/g, "\\$1");

const issueRef = (item: ScoredItem) => {
  const number = /#(\d+)$/.exec(item.id)?.[1];

  return number ? `${item.repo}#${number}` : item.repo;
};

/** Dismiss option label: the item id first, so it maps back even when titles repeat. */
const choiceLabel = (item: ScoredItem) =>
  `${item.id} ${item.title}`
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .slice(0, 100);

function renderItem(number: string, item: ScoredItem): string[] {
  const facts = [
    KIND_LABELS[item.kind],
    words(item.reason),
    ...item.feedback.filter((signal) => signal !== item.reason).map(words),
    item.unread ? "unread" : "",
  ].filter(Boolean);

  return [
    `- **${number}.** [${escapeLink(`${issueRef(item)}: ${item.title}`)}](${item.url}) · ${facts.join(" · ")}`,
    ...(item.why ? [`  - ${item.why} _(${item.whyModel})_`] : []),
    ...(item.failing.length > 0
      ? [
          `  - Failing: ${item.failing
            .map((check) =>
              check.url
                ? `[${escapeLink(check.name)}](${check.url})`
                : check.name,
            )
            .join(", ")}`,
        ]
      : []),
  ];
}

function renderReport(
  items: readonly ScoredItem[],
  workTime: boolean,
  model: string,
) {
  const numbered = items.map((item, index) => [`B${index + 1}`, item] as const);

  const header = `**${workTime ? "Work time" : "Outside work time"}** · ${items.length} item${items.length === 1 ? "" : "s"} · scored by ${model}${workTime ? "" : " · work items left out"}`;

  if (items.length === 0)
    return { body: `${header}\n\nNothing needs you right now.`, numbered };

  const sections = SECTIONS.flatMap((section) => {
    const inSection = numbered.filter(([, item]) => item.section === section);

    return inSection.length > 0
      ? [
          `## ${section}`,
          "",
          ...inSection.flatMap(([number, item]) => renderItem(number, item)),
          "",
        ]
      : [];
  });

  const question = [
    ":::question-multi",
    DISMISS_PROMPT,
    "",
    "Ticked items stay hidden until they change. Reply with a note naming a B number to start an agent on it.",
    "",
    ...numbered.map(([, item]) => `- [ ] ${choiceLabel(item)}`),
    ":::",
  ];

  return {
    body: [header, "", ...sections, ...question].join("\n"),
    numbered,
  };
}

/** Collect, score and post the daily brief, or print it with `dryRun`. */
const run = Effect.fn("brief.run")(function* (options: {
  readonly dryRun: boolean;
}) {
  const config = yield* Config;
  const output = yield* OutputLog;
  const stateDir = yield* briefStateDir;

  yield* acquireFileLock(join(stateDir, "run.lock"), { wait: "20 minutes" });

  const brief = yield* readBriefConfig();
  const last = yield* readLastReport;
  const resolutions = new Map(Object.entries(yield* readResolutions));

  const nowMs = yield* Clock.currentTimeMillis;
  const now = new Date(nowMs).toISOString();
  let supersedes: string[] = [];

  if (last) {
    const previous = last.reports[last.messageId];

    const thread = yield* readBriefThread(
      config.publicDotfiles,
      last.threadId,
    ).pipe(
      Effect.catch((error) =>
        output
          .warn(`Could not read the last brief's answers: ${error.message}`)
          .pipe(Effect.as(undefined)),
      ),
    );

    const message = thread?.messages.find(
      (entry) => entry.id === last.messageId,
    );

    for (const question of message?.questions ?? []) {
      for (const label of question.answer?.selected ?? []) {
        const id = last.choices[label];

        const item = Object.values(previous?.items ?? {}).find(
          (entry) => entry.id === id,
        );

        if (id && item)
          resolutions.set(id, {
            state: "dismissed",
            at: now,
            updatedAt: item.updatedAt,
          });
      }

      if (
        thread &&
        thread.resolved_at === null &&
        (question.state === "open" || question.state === "picked")
      )
        supersedes = [last.messageId];
    }
  }

  const collected = yield* collectBrief(brief, nowMs);
  const current = new Set(collected.map((item) => item.id));

  for (const [id, resolution] of resolutions) {
    if (!current.has(id)) {
      if (resolution.state === "dismissed")
        resolutions.set(id, { ...resolution, state: "done", at: now });
      else if (Date.parse(resolution.at) < nowMs - DONE_RETENTION_MS)
        resolutions.delete(id);
    }
  }

  const visible = collected.filter((item) => {
    const resolution = resolutions.get(item.id);

    if (!resolution) return true;

    if (
      resolution.state === "dismissed" &&
      item.updatedAt <= resolution.updatedAt
    )
      return false;

    resolutions.delete(item.id);

    return true;
  });

  const workTime = yield* isWorkTime(() => Effect.void);

  const scored = yield* output.withSpinner(
    `Scoring ${visible.length} items`,
    scoreBrief(brief, visible, workTime, stateDir),
  );

  const { body, numbered } = renderReport(
    scored,
    workTime,
    brief.decisionModel,
  );

  if (options.dryRun) {
    process.stdout.write(`${body}\n`);

    return;
  }

  const sent = yield* sendBrief({
    projectPath: config.publicDotfiles,
    body,
    idempotencyKey: `brief-${hostname()}-${now.slice(0, 10)}-${Bun.hash(body).toString(36)}`,
    supersedes,
  });

  const reports: LastReport["reports"] = Object.fromEntries(
    [
      ...Object.entries(last?.reports ?? {}),
      [
        sent.message_id,
        { postedAt: now, items: Object.fromEntries(numbered) },
      ] as const,
    ]
      .sort(([, a], [, b]) => b.postedAt.localeCompare(a.postedAt))
      .slice(0, KEPT_REPORTS),
  );

  yield* writeLastReport({
    threadId: sent.thread_id,
    messageId: sent.message_id,
    choices: Object.fromEntries(
      numbered.map(([, item]) => [choiceLabel(item), item.id]),
    ),
    reports,
  });

  yield* writeResolutions(Object.fromEntries(resolutions));

  yield* output.success(
    `Posted the daily brief with ${scored.length} items to the Plannotator Inbox`,
  );
}, Effect.scoped);

const reportFailure =
  (command: string) => (error: { readonly message: string }) =>
    Effect.sync(() => {
      console.error(`brief ${command}: ${error.message}`);
      process.exitCode = 1;
    });

/** `dot brief run`: build the daily brief and post it to the Inbox. */
export const briefRun = (options: { readonly dryRun: boolean }) =>
  run(options).pipe(Effect.catch(reportFailure("run")));

/** `dot brief dismiss`: hide an item until it has new activity. */
export const briefDismiss = (id: string) =>
  Effect.gen(function* () {
    const output = yield* OutputLog;
    const last = yield* readLastReport;
    const resolutions = yield* readResolutions;
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();

    const item = Object.values(last?.reports ?? {})
      .flatMap((report) => Object.values(report.items))
      .find((entry) => entry.id === id);

    yield* writeResolutions({
      ...resolutions,
      [id]: { state: "dismissed", at: now, updatedAt: item?.updatedAt ?? now },
    });

    yield* output.success(`Dismissed ${id} until it changes`);
  }).pipe(
    Effect.withSpan("brief.dismiss"),
    Effect.catch(reportFailure("dismiss")),
  );

/** `dot brief follow-up`: start agents for new notes on the brief. */
export const briefFollowUp = (options: { readonly dryRun: boolean }) =>
  readBriefConfig().pipe(
    Effect.flatMap((brief) => followUp(brief, options)),
    Effect.catch(reportFailure("follow-up")),
  );
