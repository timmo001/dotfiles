import { Clock, Effect, FileSystem, Schedule, Schema, Stream } from "effect";
import { dirname, join } from "node:path";
import { acquireFileLock } from "../lib/fileLock.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import type { BriefConfig } from "./config.js";
import {
  openInboxSession,
  readBriefThread,
  replyToBrief,
  waitForBriefReply,
  type InboxThread,
} from "./inbox.js";
import { trackedCheckouts } from "./repos.js";
import type { ScoredItem } from "./score.js";
import {
  briefStateDir,
  readFollowUps,
  readLastReport,
  readResolutions,
  writeFollowUps,
  writeResolutions,
  type LastReport,
} from "./state.js";

const OpenResult = Schema.Struct({ promptSent: Schema.Boolean });

/** The person's own words in a reply, without the Inbox's generated answer summary. */
const replyText = (body: string) =>
  body
    .split(/^## Answers to your questions/m)[0]
    ?.replace(/^Answered \d+ questions?\.\s*$/gm, "")
    .trim() ?? "";

/** Notes the person added to answers sent with a reply. */
const answerNotes = (thread: InboxThread, replyId: string) =>
  thread.messages.flatMap((message) =>
    (message.questions ?? []).flatMap((question) =>
      question.sent_reply_id === replyId && question.answer?.note
        ? [question.answer.note.trim()]
        : [],
    ),
  );

/** Items the person ticked to dismiss in answers sent with a reply. */
const tickedItems = (
  thread: InboxThread,
  replyId: string,
  items: Readonly<Record<string, ScoredItem>>,
) =>
  [
    ...new Set(
      thread.messages.flatMap((message) =>
        (message.questions ?? []).flatMap((question) =>
          question.sent_reply_id === replyId
            ? (question.answer?.selected ?? []).flatMap(
                (label) => /^B\d+\b/.exec(label)?.[0] ?? [],
              )
            : [],
        ),
      ),
    ),
  ].flatMap((number) => {
    const item = items[number];

    return item ? [[number, item] as const] : [];
  });

/** "B1, B3 and B4" */
const listNumbers = (numbers: readonly string[]) =>
  numbers.length > 1
    ? `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`
    : (numbers[0] ?? "");

/** Hide ticked items straight away, rather than at the next run, and say so in the thread. */
const dismissTicked = Effect.fn("brief.followUp.dismiss")(function* (
  projectPath: string,
  replyId: string,
  ticked: readonly (readonly [string, ScoredItem])[],
) {
  const now = new Date(yield* Clock.currentTimeMillis).toISOString();

  // A run in progress saves resolutions when it ends, so wait for it rather than lose these.
  yield* Effect.gen(function* () {
    yield* acquireFileLock(join(yield* briefStateDir, "run.lock"), {
      wait: "20 minutes",
    });

    const resolutions = yield* readResolutions;

    yield* writeResolutions({
      ...resolutions,
      ...Object.fromEntries(
        ticked.map(([, item]) => [
          item.id,
          { state: "dismissed" as const, at: now, updatedAt: item.updatedAt },
        ]),
      ),
    });
  }).pipe(Effect.scoped);

  yield* replyToBrief({
    projectPath,
    replyTo: replyId,
    body: `Hidden ${listNumbers(ticked.map(([number]) => number))} until they change.`,
  });
});

const itemSummary = (number: string, item: ScoredItem) =>
  [
    `### ${number}: [${item.title}](${item.url})`,
    "",
    `- Repository: ${item.repo}`,
    `- Kind: ${item.draft ? "draft " : ""}${item.kind}, ${item.work ? "work" : "side project"}${item.crossover ? " (crossover)" : ""}`,
    `- Why it's involved: ${item.reason.replaceAll("_", " ")}`,
    `- Feedback waiting: ${item.feedback.map((signal) => signal.replaceAll("_", " ")).join(", ") || "none"}`,
    `- Score: ${item.score.toFixed(2)}${item.why ? `; reason: ${item.why} (${item.whyModel})` : ""}`,
    ...item.failing.map(
      (check) =>
        `- Failing check: ${check.name}${check.url ? ` ${check.url}` : ""}`,
    ),
  ].join("\n");

/** Which report a reply belongs to: the one it answers, else the latest before it. */
const reportFor = (
  last: LastReport,
  replyTo: string | null,
  createdAt: string,
) =>
  (replyTo ? last.reports[replyTo] : undefined) ??
  Object.values(last.reports)
    .filter((report) => report.postedAt <= createdAt)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))[0];

/** Hide items ticked in replies and start agents for notes left on the brief since the last check. */
export const briefFollowUp = Effect.fn("brief.followUp")(function* (
  brief: BriefConfig,
  options: { readonly dryRun: boolean },
) {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const output = yield* OutputLog;
  const last = yield* readLastReport;

  if (!last) {
    yield* output.info("No brief has been posted yet");

    return;
  }

  const handled = [...(yield* readFollowUps)];
  const thread = yield* readBriefThread(config.publicDotfiles, last.threadId);

  const oldest = Object.values(last.reports)
    .map((report) => report.postedAt)
    .sort()[0];

  const notes = thread.messages.filter(
    (message) =>
      message.author.kind === "person" &&
      !handled.includes(message.id) &&
      oldest !== undefined &&
      message.created_at >= oldest,
  );

  for (const message of notes) {
    if ((message.set_aside?.length ?? 0) > 0) {
      handled.push(message.id);
      continue;
    }

    const report = reportFor(last, message.reply_to, message.created_at);
    const items = report?.items ?? {};
    const ticked = tickedItems(thread, message.id, items);

    if (ticked.length > 0) {
      if (options.dryRun)
        yield* output.info(
          `Reply ${message.id} hides ${listNumbers(ticked.map(([number]) => number))}`,
        );
      else {
        yield* dismissTicked(config.publicDotfiles, message.id, ticked);
        yield* output.info(
          `Hid ${ticked.length} item${ticked.length === 1 ? "" : "s"} for reply ${message.id}`,
        );
      }
    }

    const words = [
      replyText(message.body),
      ...answerNotes(thread, message.id),
    ].filter(Boolean);

    if (words.length === 0) {
      handled.push(message.id);
      continue;
    }

    const named = [
      ...new Set(
        [...words.join("\n").matchAll(/\bB(\d+)\b/gi)].map(
          (match) => `B${match[1]}`,
        ),
      ),
    ].flatMap((number) => {
      const item = items[number];

      return item ? [[number, item] as const] : [];
    });

    const repos = [...new Set(named.map(([, item]) => item.repo))];

    const tracked =
      repos.length === 1 && repos[0]
        ? (yield* trackedCheckouts(repos)).get(repos[0].toLowerCase())
        : undefined;

    const target = tracked ?? {
      name: "Dotfiles",
      path: config.publicDotfiles,
    };

    const placement = tracked
      ? `You're in the ${tracked.name} checkout, which owns the item.`
      : repos.length > 1
        ? `The note names items in several repositories (${repos.join(", ")}), so you've started in the dotfiles checkout. Work in each item's own checkout; \`dot repo list <owner/repo>\` finds them.`
        : repos.length === 1
          ? `${repos[0]} isn't a tracked checkout on this machine, so you've started in the dotfiles checkout. Clone or find it before changing anything.`
          : "The note doesn't name an item by its B number, so you've started in the dotfiles checkout with the whole report below.";

    const prompt = [
      "# Follow-up from my daily brief",
      "",
      "I left this note on my daily brief in the Plannotator Inbox. Follow it up.",
      "",
      words.map((text) => text.replace(/^/gm, "> ")).join("\n>\n"),
      "",
      placement,
      "",
      named.length > 0 ? "## Items the note names" : "## The report",
      "",
      ...(named.length > 0
        ? named.flatMap(([number, item]) => [
            itemSummary(number, item),
            "",
            ...(item.detail ? [item.detail, ""] : []),
          ])
        : Object.entries(items).flatMap(([number, item]) => [
            itemSummary(number, item),
            "",
          ])),
      "## Replying",
      "",
      `Reply in the Plannotator Inbox with \`plannotator_inbox\` \`send_message\`, \`reply_to: "${message.id}"\` (thread ${thread.thread_id}), so my next reply reaches you.`,
      "",
      "Check your model with `dot session status`. If the work needs a stronger one, say so; `dot herdr model` switches it.",
    ].join("\n");

    if (options.dryRun) {
      yield* output.info(
        `Note ${message.id} -> ${target.name} (${target.path})`,
      );
      process.stdout.write(`${prompt}\n\n`);
      continue;
    }

    const file = join(yield* briefStateDir, "follow-ups", `${message.id}.md`);

    yield* fs.makeDirectory(dirname(file), { recursive: true });
    yield* fs.writeFileString(file, `${prompt}\n`);

    const opened = yield* executor
      .run("dot", [
        "herdr",
        "repo",
        "open",
        target.name,
        target.path,
        "--agent",
        "opencode2",
        "--prompt-file",
        file,
        "--no-focus",
        "--json",
        ...(brief.followUpModel ? ["--model", brief.followUpModel] : []),
      ])
      .pipe(
        Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(OpenResult))),
        Effect.orElseSucceed(() => ({ promptSent: false })),
      );

    if (!opened.promptSent) {
      yield* output.warn(
        `Could not start an agent for note ${message.id}; trying again next time`,
      );
      continue;
    }

    yield* output.info(
      `Started an agent in ${target.name} for note ${message.id}`,
    );
    handled.push(message.id);
  }

  if (!options.dryRun) yield* writeFollowUps(handled);
});

/** Resolves when `dot brief run` saves a new report. */
const nextReport = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* briefStateDir;

  yield* fs.makeDirectory(dir, { recursive: true });

  yield* fs.watch(dir).pipe(
    Stream.filter((event) => event.path.endsWith("last.json")),
    Stream.runHead,
  );
});

/**
 * Wait for replies on the brief and start agents as soon as one lands. Holds
 * one Inbox connection open with `wait_for_reply`, moves to a new thread when
 * a brief starts one, and sleeps on the state directory while there's no open
 * thread. The connection is reopened after a failure.
 */
export const watchFollowUps = Effect.fn("brief.followUp.watch")(function* (
  brief: BriefConfig,
) {
  const config = yield* Config;
  const output = yield* OutputLog;

  const handleNotes = briefFollowUp(brief, { dryRun: false }).pipe(
    Effect.catch((error) =>
      output.warn(`Could not follow up the brief: ${error.message}`),
    ),
  );

  const watch = Effect.gen(function* () {
    const session = yield* openInboxSession;
    let threadId: string | undefined;
    let cursor: number | undefined;

    yield* output.info("Waiting for replies on the daily brief");

    for (;;) {
      const last = yield* readLastReport;

      if (!last) {
        yield* nextReport;
        continue;
      }

      if (last.threadId !== threadId) {
        threadId = last.threadId;
        cursor = undefined;
        // Catch up on anything sent while nothing was waiting.
        yield* handleNotes;
      }

      const result = yield* waitForBriefReply(session, {
        projectPath: config.publicDotfiles,
        threadId,
        cursor,
      });

      cursor = result.cursor ?? cursor;

      if (result.status === "replied") yield* handleNotes;
      else if (result.status === "resolved") yield* nextReport;
    }
  }).pipe(Effect.scoped);

  return yield* watch.pipe(
    Effect.tapError((error) =>
      output.warn(`Brief follow-up watch stopped: ${error.message}; retrying`),
    ),
    Effect.retry(Schedule.spaced("30 seconds")),
  );
});
