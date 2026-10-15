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

/** A priority rule applied after the decision model scores an item. */
const BriefRule = Schema.Struct({
  /** Site pattern matched against the item's URL, as in `links.sites`. */
  match: Schema.optionalKey(
    Schema.String.check(
      Schema.isPattern(/^(\*\.)?[a-z0-9.-]+(:\d+)?(\/\S*)?$/i),
    ),
  ),
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
});

/** Settings for `dot brief`, with defaults filled in. */
export interface BriefConfig {
  /** Model that scores each item: Ollaya, or Workers AI for `@cf/` models. */
  readonly decisionModel: string;
  /** Plain-language priorities given to the decision and reason models. */
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
}

/** Path of the private brief settings, stowed from the private overlay. */
export const BRIEF_CONFIG_PATH = join(CONFIG_DIR, "dot", "brief.yml");

/** Workers AI account and token for `@cf/` decision models, written by a secret file. */
export const WORKERS_AI_PATH = join(
  CONFIG_DIR,
  "dot",
  "brief",
  "workers-ai.yml",
);

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
  } satisfies BriefConfig;
});
