import { Clock, Effect } from "effect";
import { hostname } from "node:os";
import { join } from "node:path";
import { acquireFileLock } from "../lib/fileLock.js";
import { isWorkTime, readWorkSchedule } from "../lib/workTime.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import {
  collectBrief,
  type BriefItem,
  type BriefWorkLists,
} from "../brief/collect.js";
import { workDayEvents, type WorkDay } from "../brief/calendar.js";
import { readBriefConfig } from "../brief/config.js";
import {
  briefFollowUp as followUp,
  watchFollowUps,
} from "../brief/followUp.js";
import { readBriefThread, sendBrief } from "../brief/inbox.js";
import {
  SECTIONS,
  scoreBrief,
  tagAreas,
  type AreaTags,
  type ScoredItem,
} from "../brief/score.js";
import { trackedCheckouts, type TrackedCheckout } from "../brief/repos.js";
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Work days and area tags remembered between reports. */
const KEPT_WORK_DAYS = 14;

const KEPT_AREA_TAGS = 40;

const NO_TAGS: AreaTags = { items: new Map(), sections: new Map() };

const localDate = (ms: number) => new Date(ms).toLocaleDateString("en-CA");

const KIND_ICONS: Record<ScoredItem["kind"], string> = {
  pr: "🟣",
  issue: "🟢",
  notification: "🔵",
  ci: "🔴",
};

const DISMISS_PROMPT =
  "Which of these can drop off until something new happens?";

const words = (value: string) => value.replaceAll("_", " ");

const escapeMarkdown = (text: string) => text.replace(/([[\]\\*_`])/g, "\\$1");

const icon = (item: BriefItem) => (item.draft ? "⚪" : KIND_ICONS[item.kind]);

const issueNumber = (item: BriefItem) => /#(\d+)$/.exec(item.id)?.[1];

/** Tracked names for the items' repositories, such as `[HA] Core`. */
type RepoNames = ReadonlyMap<string, TrackedCheckout>;

const repoName = (item: BriefItem, names: RepoNames) =>
  names.get(item.repo.toLowerCase())?.name ?? item.repo;

/**
 * Dismiss option label. It leads with the B number so it stays unique, and
 * leaves out `owner/repo#n`, which the Inbox would turn into a reference chip.
 */
const choiceLabel = (number: string, item: ScoredItem, names: RepoNames) =>
  `${number} ${icon(item)} ${repoName(item, names)}: ${item.title}`
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .slice(0, 100);

/** Icon, repository and linked title, shared by numbered and work-time lines. */
function itemTitle(item: BriefItem, names: RepoNames) {
  const ref = issueNumber(item);

  return `${icon(item)} **${escapeMarkdown(repoName(item, names))}** · [${escapeMarkdown(`${ref ? `#${ref} ` : ""}${item.title}`)}](${item.url})`;
}

function renderItem(
  number: string,
  item: ScoredItem,
  names: RepoNames,
  showModel: boolean,
): string[] {
  const facts = [
    ...(item.areas ?? []),
    words(item.reason),
    ...item.feedback.filter((signal) => signal !== item.reason).map(words),
    item.unread ? "unread" : "",
    ...(item.context ?? []),
  ].filter(Boolean);

  return [
    `- **${number}.** ${itemTitle(item, names)} · ${facts.join(" · ")}`,
    ...(item.why
      ? [`  - ${item.why}${showModel ? ` _(${item.whyModel})_` : ""}`]
      : []),
    ...(item.failing.length > 0
      ? [
          `  - Failing: ${item.failing
            .map((check) =>
              check.url
                ? `[${escapeMarkdown(check.name)}](${check.url})`
                : escapeMarkdown(check.name),
            )
            .join(", ")}`,
        ]
      : []),
  ];
}

/** A work-time section after Later, with lines but no B numbers. */
interface WorkSection {
  readonly name: string;
  /** Whether the heading gets an emoji from the area tags. */
  readonly tagged: boolean;
  readonly lines: readonly {
    readonly item: BriefItem;
    readonly facts: readonly string[];
  }[];
  /** Markdown appended as the last line, such as "and N more". */
  readonly footer: string | undefined;
}

const formatDay = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const stateFacts = (item: BriefItem) => [
  item.state === "open" ? "open" : "",
  ...(item.context ?? []),
];

/** The work-time sections, each leaving out items shown earlier in the report. */
function workSections(
  work: BriefWorkLists,
  shown: ReadonlySet<string>,
): WorkSection[] {
  const seen = new Set(shown);

  const take = (items: readonly BriefItem[], limit = Infinity) => {
    const fresh = items.filter((item) => !seen.has(item.id));
    const picked = fresh.slice(0, limit);

    for (const item of picked) seen.add(item.id);

    return { picked, duplicates: items.length - fresh.length };
  };

  const resolved = take(work.closed).picked;

  const quiet = (item: BriefItem) =>
    (item.labels ?? []).includes("no-stale") && item.updatedAt < work.since;

  const tasks = take(work.tasks.filter((item) => !quiet(item))).picked;

  const quietCount = work.tasks.filter(
    (item) => quiet(item) && !seen.has(item.id),
  ).length;

  const lists = [...work.areas, ...work.scopes].map((list): WorkSection => {
    const { picked, duplicates } = take(list.items, list.limit);
    const more = list.total - picked.length - duplicates;

    return {
      name: list.name,
      tagged: true,
      lines: picked.map((item) => ({ item, facts: stateFacts(item) })),
      footer: more > 0 ? `- [and ${more} more](${list.url})` : undefined,
    };
  });

  return [
    {
      name: "Resolved",
      tagged: false,
      lines: resolved.map((item) => ({ item, facts: stateFacts(item) })),
      footer: undefined,
    },
    {
      name: "Your tasks",
      tagged: false,
      lines: tasks.map((item) => ({
        item,
        facts: [words(item.reason), ...(item.context ?? [])],
      })),
      footer:
        quietCount > 0
          ? `- [${quietCount} older no-stale issue${quietCount === 1 ? "" : "s"}](https://github.com/issues?q=${encodeURIComponent("is:issue is:open label:no-stale (author:@me OR assignee:@me)")})`
          : undefined,
    },
    ...lists,
  ].filter((section) => section.lines.length > 0 || section.footer);
}

function renderWorkSection(
  section: WorkSection,
  tags: AreaTags,
  names: RepoNames,
) {
  const emoji = section.tagged ? tags.sections.get(section.name) : undefined;

  return [
    `## ${emoji ? `${emoji} ` : ""}${section.name}`,
    "",
    ...section.lines.map(({ item, facts }) => {
      const extra = [
        ...(tags.items.get(item.id) ?? []).filter(
          (tag) => !emoji || !tag.startsWith(emoji),
        ),
        ...facts,
      ].filter(Boolean);

      return `- ${itemTitle(item, names)}${extra.map((fact) => ` · ${fact}`).join("")}`;
    }),
    ...(section.footer ? [section.footer] : []),
    "",
  ];
}

function renderReport(
  items: readonly ScoredItem[],
  names: RepoNames,
  workTime: boolean,
  model: string,
  work?: {
    readonly since: string;
    readonly days: readonly WorkDay[];
    readonly sections: readonly WorkSection[];
    readonly tags: AreaTags;
  },
) {
  const numbered = items.map((item, index) => [`B${index + 1}`, item] as const);

  const reasonModels = [
    ...new Set(items.flatMap((item) => (item.whyModel ? [item.whyModel] : []))),
  ];

  const header = [
    `**${workTime ? "Work time" : "Outside work time"}**${work ? ` · since ${formatDay(work.since)}` : ""} · ${items.length} item${items.length === 1 ? "" : "s"} · scored by ${model}${reasonModels.length === 1 ? ` · reasons by ${reasonModels[0]}` : ""}${workTime ? "" : " · work items left out"}`,
    ...(work?.days ?? []).flatMap((day) => [
      "",
      `**${day.label}:** ${day.events.map((event) => `${event.time} ${escapeMarkdown(event.summary)}`).join(" · ")}`,
    ]),
  ].join("\n");

  const legend =
    "🟣 PR · ⚪ draft PR · 🟢 issue · 🔴 failing CI · 🔵 notification";

  const extra = (work?.sections ?? []).flatMap((section) =>
    renderWorkSection(section, work?.tags ?? NO_TAGS, names),
  );

  if (items.length === 0)
    return {
      body:
        extra.length > 0
          ? [
              header,
              "",
              "Nothing needs you right now.",
              "",
              legend,
              "",
              ...extra,
            ]
              .join("\n")
              .trimEnd()
          : `${header}\n\nNothing needs you right now.`,
      numbered,
    };

  const sections = SECTIONS.flatMap((section) => {
    const inSection = numbered.filter(([, item]) => item.section === section);

    return inSection.length > 0
      ? [
          `## ${section}`,
          "",
          ...inSection.flatMap(([number, item]) =>
            renderItem(number, item, names, reasonModels.length > 1),
          ),
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
    ...numbered.map(
      ([number, item]) => `- [ ] ${choiceLabel(number, item, names)}`,
    ),
    ":::",
  ];

  return {
    body: [header, "", legend, "", ...sections, ...extra, ...question].join(
      "\n",
    ),
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

  const workTime = yield* isWorkTime(() => Effect.void);
  const today = localDate(nowMs);
  const earliest = localDate(nowMs - brief.work.lookbackDays * DAY_MS);

  const workDays = workTime
    ? ((yield* readWorkSchedule(() => Effect.void))?.work_hours.days ?? [])
    : [];

  // Before any work day is saved, start at the previous day in the schedule.
  const lastWorkDay =
    last?.workDays?.find((day) => day < today) ??
    localDate(
      nowMs -
        ([1, 2, 3, 4, 5, 6, 7].find((offset) =>
          workDays.includes(new Date(nowMs - offset * DAY_MS).getDay() || 7),
        ) ?? 1) *
          DAY_MS,
    );

  const since = workTime
    ? lastWorkDay > earliest
      ? lastWorkDay
      : earliest
    : undefined;

  const { items: collected, work } = yield* collectBrief(brief, nowMs, since);
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

  const scoredItems = yield* output.withSpinner(
    `Scoring ${visible.length} items`,
    scoreBrief(brief, visible, workTime, stateDir),
  );

  const sections = work
    ? workSections(work, new Set(scoredItems.map((item) => item.id)))
    : [];

  const [tags, days] = work
    ? yield* Effect.all(
        [
          output.withSpinner(
            "Tagging areas",
            tagAreas(
              brief,
              [
                ...scoredItems,
                ...sections.flatMap((section) =>
                  section.lines.map((line) => line.item),
                ),
              ],
              sections
                .filter((section) => section.tagged)
                .map((section) => section.name),
              last?.areaTags ?? [],
              stateDir,
            ),
          ),
          workDayEvents(brief.work.calendar, nowMs),
        ],
        { concurrency: "unbounded" },
      )
    : [NO_TAGS, []];

  const scored = work
    ? scoredItems.map((item) => ({
        ...item,
        areas: tags.items.get(item.id) ?? [],
      }))
    : scoredItems;

  const allItems = [
    ...scored,
    ...sections.flatMap((section) => section.lines.map((line) => line.item)),
  ];

  const names = yield* trackedCheckouts(allItems.map((item) => item.repo));

  const { body, numbered } = renderReport(
    scored,
    names,
    workTime,
    brief.decisionModel,
    work && { since: work.since, days, sections, tags },
  );

  if (options.dryRun) {
    process.stdout.write(`${body}\n`);

    return;
  }

  const sent = yield* sendBrief({
    projectPath: config.publicDotfiles,
    body,
    idempotencyKey: `brief-${hostname()}-${now}`,
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
      numbered.map(([number, item]) => [
        choiceLabel(number, item, names),
        item.id,
      ]),
    ),
    reports,
    ...(work
      ? {
          workDays: [
            today,
            ...(last?.workDays ?? []).filter((day) => day !== today),
          ].slice(0, KEPT_WORK_DAYS),
          areaTags: [
            ...new Set([
              ...[...tags.items.values()].flat(),
              ...(last?.areaTags ?? []),
            ]),
          ].slice(0, KEPT_AREA_TAGS),
        }
      : {
          ...(last?.workDays && { workDays: last.workDays }),
          ...(last?.areaTags && { areaTags: last.areaTags }),
        }),
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
export const briefFollowUp = (options: {
  readonly dryRun: boolean;
  readonly watch: boolean;
}) =>
  readBriefConfig().pipe(
    Effect.flatMap((brief) =>
      options.watch ? watchFollowUps(brief) : followUp(brief, options),
    ),
    Effect.catch(reportFailure("follow-up")),
  );
