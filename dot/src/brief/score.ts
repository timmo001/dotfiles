import { Duration, Effect, Option, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import {
  decide as decideWith,
  workersAiFor,
  type DecisionQuestion,
  type WorkersAi,
} from "../lib/decisionModel.js";
import { opencodeText, withoutDashes } from "../lib/opencodeText.js";
import { BriefItem, ruleMatches } from "./collect.js";
import { BriefConfigError, type BriefConfig } from "./config.js";

/** Report sections, in display order. */
export const SECTIONS = ["Focus", "Crossover", "Later"] as const;

/** A brief item with its score, section and written reason. */
export const ScoredItem = Schema.Struct({
  ...BriefItem.fields,
  section: Schema.Literals(SECTIONS),
  /** Decision model urgency, 0 (can wait) to 3 (blocking someone now). */
  urgency: Schema.NullOr(Schema.Finite),
  /** Decision model probability that it waits on me. */
  needsMe: Schema.NullOr(Schema.Finite),
  /** Final score after rules, used for ordering. */
  score: Schema.Finite,
  /** What other people's comments ask of you, written at work time only. */
  why: Schema.NullOr(Schema.String),
  /** Model that wrote {@link why}. */
  whyModel: Schema.NullOr(Schema.String),
  /** Area tags in emoji form, such as `📊 Dashboards`, written at work time only. */
  areas: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** Decoded {@link ScoredItem}. */
export type ScoredItem = typeof ScoredItem.Type;

const QUESTIONS = {
  urgency: {
    type: "score",
    instructions: "How urgent is `item` for me, given `priorities`?",
    criteria: ["can wait", "this week", "today", "blocking someone now"],
  },
  needs_me: {
    type: "noul",
    instructions: "Is `item` waiting on me to act?",
  },
} satisfies Record<string, DecisionQuestion>;

const Answers = Schema.Struct({
  urgency: Schema.Struct({ score: Schema.Finite }),
  needs_me: Schema.Struct({ noul: Schema.Finite }),
});

/** Built-in boosts: a pending review comes first, then other feedback. */
const FEEDBACK_BOOST = new Map([
  ["review_requested", 1.5],
  ["changes_requested", 0.5],
  ["open_threads", 0.5],
  ["new_comments", 0.5],
]);

const modelState = (item: BriefItem) => ({
  kind: item.kind,
  repo: item.repo,
  title: item.title,
  draft: item.draft ?? false,
  reason: item.reason,
  feedback: item.feedback,
  updated: item.updatedAt,
  unread: item.unread,
  failing_checks: item.failing.map((check) => check.name),
});

const decide = Effect.fn("brief.decide")(function* (
  config: BriefConfig,
  item: BriefItem,
  workersAi: WorkersAi | undefined,
) {
  const answers = yield* decideWith({
    model: config.decisionModel,
    questions: QUESTIONS,
    state: { priorities: config.priorities, item: modelState(item) },
    workersAi,
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Answers)));

  return {
    urgency: answers.urgency.score,
    needsMe: answers.needs_me.noul,
  };
});

/** Summarise what people are asking of me, from an item's comments, threads and failing checks. */
const explain = Effect.fn("brief.explain")(function* (
  config: BriefConfig,
  item: ScoredItem,
  cwd: string,
) {
  // Priorities only order the brief, so they stay out of the reason.
  const prompt = [
    "You're summarising one item in my daily GitHub brief. Don't use any tools.",
    `The item:\n${JSON.stringify(modelState(item), null, 2)}`,
    `Its open review threads, recent comments and failing checks. Comments marked (me) are mine:\n${item.detail}`,
    "In one sentence (30 words at most), say specifically what the latest comments or threads from other people ask of me, naming who asked, or what is failing. Don't restate the item's status, give advice, or judge whether it can wait. If nobody else is asking anything, reply with NONE. Use UK English and no dashes. Reply with the sentence only.",
  ].join("\n\n");

  for (const model of config.explainModels) {
    const text = yield* opencodeText({
      model,
      prompt,
      title: "Daily brief reason",
      cwd,
      timeout: config.explainTimeout,
    });

    const reply = text && withoutDashes(text);

    if (reply && /^NONE\b/.test(reply)) break;

    if (reply) return { why: reply, whyModel: model };
  }

  return { why: null, whyModel: null };
});

const AreaTagsReply = Schema.Struct({
  items: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  sections: Schema.Record(Schema.String, Schema.String),
});

/** Item and section tags, empty when the model fails. */
export interface AreaTags {
  readonly items: ReadonlyMap<string, readonly string[]>;
  readonly sections: ReadonlyMap<string, string>;
}

/**
 * Ask the first reasons model, in one call, for each item's area tags in
 * emoji form and an emoji for each section name. `vocabulary` holds recent
 * tags so names stay steady between reports.
 */
export const tagAreas = Effect.fn("brief.tagAreas")(function* (
  config: BriefConfig,
  items: readonly BriefItem[],
  sections: readonly string[],
  vocabulary: readonly string[],
  cwd: string,
) {
  const empty: AreaTags = { items: new Map(), sections: new Map() };
  const model = config.explainModels[0];

  if (!model || items.length === 0) return empty;

  const prompt = [
    "You're tagging items in my daily GitHub brief for work on Home Assistant. Don't use any tools.",
    "Tag each item with the area it belongs to, as an emoji and a short name in sentence case, such as 📊 Dashboards. Use one tag, or two when it clearly spans areas. Reuse a tag from this list when one fits:",
    JSON.stringify(vocabulary),
    `The items:\n${JSON.stringify(items.map(({ id, repo, title, labels }) => ({ id, repo, title, labels: labels ?? [] })))}`,
    `Also pick one emoji for each of these section names:\n${JSON.stringify(sections)}`,
    'Reply with JSON only, no code fence: {"items": {"<id>": ["📊 Dashboards"]}, "sections": {"<name>": "🛒"}}',
  ].join("\n\n");

  const text = yield* opencodeText({
    model,
    prompt,
    title: "Daily brief areas",
    cwd,
    timeout: Duration.times(config.explainTimeout, 3),
  });

  const json = text?.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);

  const decoded = json
    ? Schema.decodeOption(Schema.fromJsonString(AreaTagsReply))(json)
    : Option.none();

  if (Option.isNone(decoded)) return empty;

  return {
    items: new Map(
      Object.entries(decoded.value.items).map(([id, tags]) => [
        id,
        tags.slice(0, 2).map(withoutDashes),
      ]),
    ),
    sections: new Map(Object.entries(decoded.value.sections)),
  } satisfies AreaTags;
});

/** Score, section and order items, then, at work, summarise the comments on the top few. */
export const scoreBrief = Effect.fn("brief.score")(function* (
  config: BriefConfig,
  items: readonly BriefItem[],
  workTime: boolean,
  cwd: string,
) {
  const included = items.filter(
    (item) => workTime || !item.work || item.crossover,
  );

  const workersAi = yield* workersAiFor(config.decisionModel).pipe(
    Effect.mapError(
      (error) => new BriefConfigError({ message: error.message }),
    ),
  );

  const scored = yield* Effect.forEach(
    included,
    (item) =>
      decide(config, item, workersAi).pipe(
        Effect.orElseSucceed(() => ({ urgency: null, needsMe: null })),
        Effect.map(({ urgency, needsMe }): ScoredItem => {
          const needs = Math.max(
            needsMe ?? 0.5,
            item.feedback.length > 0 ? 1 : 0,
          );

          const boosts =
            item.feedback.reduce(
              (sum, signal) => sum + (FEEDBACK_BOOST.get(signal) ?? 0),
              0,
            ) +
            config.rules.reduce(
              (sum, rule) =>
                sum + (ruleMatches(rule, item) ? (rule.boost ?? 0) : 0),
              0,
            ) +
            (item.unread ? 0.25 : 0);

          return {
            ...item,
            section: item.crossover
              ? "Crossover"
              : workTime === item.work
                ? "Focus"
                : "Later",
            urgency,
            needsMe,
            score: (urgency ?? 1.5) / 3 + needs + boosts,
            why: null,
            whyModel: null,
          };
        }),
      ),
    { concurrency: 4 },
  );

  const kept = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, config.limit);

  const ordered = SECTIONS.flatMap((section) =>
    kept.filter((item) => item.section === section),
  );

  // Reasons only help at work, and only when there's something to read.
  const top = workTime
    ? [...ordered]
        .filter((item) => item.detail.trim() !== "")
        .sort((a, b) => b.score - a.score)
        .slice(0, config.explainTop)
    : [];

  const reasons = yield* Effect.forEach(
    top,
    (item) => explain(config, item, cwd),
    { concurrency: 1 },
  );

  const byId = new Map(top.map((item, index) => [item.id, reasons[index]]));

  return ordered.map((item) => ({ ...item, ...byId.get(item.id) }));
}, Effect.provide(FetchHttpClient.layer));
