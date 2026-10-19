import { Duration, Effect, FileSystem, Schema } from "effect";
import { join } from "node:path";
import { pathExists } from "../lib/fsProbe.js";
import { currentOmarchyHost } from "../lib/omarchyHost.js";
import { CONFIG_DIR } from "../lib/paths.js";

/** Failure to read or decode `brief.yml`. */
export class BriefConfigError extends Schema.TaggedError<BriefConfigError>()(
  "BriefConfigError",
  { message: Schema.String },
) {}

/** Site pattern matched against an item's URL, as in `links.sites`. */
const SitePattern = Schema.String.check(
  Schema.isPattern(/^(\*\.)?[a-z0-9.-]+(:\d+)?(\/\S*)?$/i),
);

/** A priority rule applied after the decision model scores an item. */
const BriefRule = Schema.Struct({
  /** Site pattern matched against the item's URL, as in `links.sites`. */
  match: Schema.optionalKey(SitePattern),
  /** Item reason, such as `subscribed` or `review_requested`. */
  reason: Schema.optionalKey(Schema.NonEmptyString),
  /** Feedback signal, such as `changes_requested`. */
  feedback: Schema.optionalKey(Schema.NonEmptyString),
  /** Added to the item's score. */
  boost: Schema.optionalKey(Schema.Finite),
  /** Overrides whether the item counts as work. */
  work: Schema.optionalKey(Schema.Boolean),
  /** Shows the item in the crossover section, whatever the time. */
  crossover: Schema.optionalKey(Schema.Boolean),
}).check(
  Schema.makeFilter((rule) =>
    rule.match || rule.reason || rule.feedback
      ? undefined
      : "a rule needs a match, reason or feedback",
  ),
);

/** Decoded {@link BriefRule}. */
export type BriefRule = typeof BriefRule.Type;

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

/** A work-time section filled from GitHub searches. */
const WorkScope = Schema.Struct({
  name: Schema.NonEmptyString,
  /** GitHub searches; `{since}` becomes the window's ISO date. */
  queries: Schema.Array(Schema.NonEmptyString),
  limit: Schema.optionalKey(PositiveInt),
});

const WorkConfig = Schema.Struct({
  /** Home Assistant calendar shown as the day's meetings. */
  calendar: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^calendar\.[a-z0-9_]+$/)),
  ),
  /** Left out of the work-time sections. */
  exclude: Schema.optionalKey(Schema.Array(SitePattern)),
  scopes: Schema.optionalKey(Schema.Array(WorkScope)),
  follow: Schema.optionalKey(
    Schema.Struct({
      days: Schema.optionalKey(PositiveInt),
      areas: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(-1))),
      limit: Schema.optionalKey(PositiveInt),
      /** Labels that say nothing about an area; a trailing `*` matches a prefix. */
      ignore_labels: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
    }),
  ),
  lookback_days: Schema.optionalKey(PositiveInt),
});

/** A work-time scope with defaults filled in. */
export interface BriefWorkScope {
  readonly name: string;
  readonly queries: readonly string[];
  readonly limit: number;
}

/** Work-time additions to the brief, with defaults filled in. */
export interface BriefWork {
  readonly calendar: string | undefined;
  readonly exclude: readonly string[];
  readonly scopes: readonly BriefWorkScope[];
  /** Days of my own PRs and reviews used to find the areas I work in. */
  readonly followDays: number;
  /** How many of those areas get a section. */
  readonly followAreas: number;
  /** Items listed per followed area. */
  readonly followLimit: number;
  readonly ignoreLabels: readonly string[];
  /** Longest lookback window, in days. */
  readonly lookbackDays: number;
}

const BriefConfigSchema = Schema.Struct({
  decision_model: Schema.optionalKey(Schema.NonEmptyString),
  priorities: Schema.optionalKey(Schema.String),
  rules: Schema.optionalKey(Schema.Array(BriefRule)),
  explain: Schema.optionalKey(
    Schema.Struct({
      top: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(-1))),
      timeout: Schema.optionalKey(Schema.DurationFromString),
      models: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
    }),
  ),
  report: Schema.optionalKey(
    Schema.Struct({
      limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
    }),
  ),
  follow_up: Schema.optionalKey(
    Schema.Struct({ model: Schema.optionalKey(Schema.NonEmptyString) }),
  ),
  hosts: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        decision_model: Schema.optionalKey(Schema.NonEmptyString),
      }),
    ),
  ),
  work: Schema.optionalKey(WorkConfig),
});

/** Settings for `dot brief`, with defaults filled in. */
export interface BriefConfig {
  /** Model that scores each item: Ollaya, or Workers AI for `@cf/` models. */
  readonly decisionModel: string;
  /** Plain-language priorities given to the decision model for scoring. */
  readonly priorities: string;
  /** Rules applied after scoring, in order. */
  readonly rules: readonly BriefRule[];
  /** How many of the top items get a written reason. */
  readonly explainTop: number;
  /** Time allowed for each reason model attempt. */
  readonly explainTimeout: Duration.Duration;
  /** OpenCode models tried in order for reasons; empty skips them. */
  readonly explainModels: readonly string[];
  /** Maximum items in a report. */
  readonly limit: number;
  /** OpenCode model for follow-up agents; OpenCode's default when unset. */
  readonly followUpModel: string | undefined;
  /** What the brief adds at work time. */
  readonly work: BriefWork;
}

/** Path of the private brief settings, stowed from the private overlay. */
export const BRIEF_CONFIG_PATH = join(CONFIG_DIR, "dot", "brief.yml");

/** Read `brief.yml`, falling back to defaults when it is missing. */
export const readBriefConfig = Effect.fn("brief.readConfig")(function* () {
  const fs = yield* FileSystem.FileSystem;

  const raw = (yield* pathExists(BRIEF_CONFIG_PATH))
    ? yield* fs.readFileString(BRIEF_CONFIG_PATH).pipe(
        Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
        Effect.flatMap((parsed) =>
          Schema.decodeUnknownEffect(BriefConfigSchema)(parsed, {
            onExcessProperty: "error",
          }),
        ),
        Effect.mapError(
          (error) =>
            new BriefConfigError({
              message: `${BRIEF_CONFIG_PATH}: ${error.message}`,
            }),
        ),
      )
    : {};

  const host = currentOmarchyHost();

  return {
    decisionModel:
      (host ? raw.hosts?.[host]?.decision_model : undefined) ??
      raw.decision_model ??
      "winnow:e4b",
    priorities: raw.priorities?.trim() ?? "",
    rules: raw.rules ?? [],
    explainTop: raw.explain?.top ?? 5,
    explainTimeout: raw.explain?.timeout ?? Duration.seconds(60),
    explainModels: raw.explain?.models ?? [],
    limit: raw.report?.limit ?? 25,
    followUpModel: raw.follow_up?.model,
    work: {
      calendar: raw.work?.calendar,
      exclude: raw.work?.exclude ?? [],
      scopes: (raw.work?.scopes ?? []).map((scope) => ({
        name: scope.name,
        queries: scope.queries,
        limit: scope.limit ?? 10,
      })),
      followDays: raw.work?.follow?.days ?? 30,
      followAreas: raw.work?.follow?.areas ?? 4,
      followLimit: raw.work?.follow?.limit ?? 5,
      ignoreLabels: raw.work?.follow?.ignore_labels ?? [],
      lookbackDays: raw.work?.lookback_days ?? 14,
    },
  } satisfies BriefConfig;
});
