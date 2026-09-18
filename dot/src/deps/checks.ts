import { createHash } from "node:crypto";
import { Api, GhCommandError } from "@timmo001/effect-gh";
import { Effect, Predicate, Record, Schema } from "effect";
import type { DependencyConfig } from "./config.js";
import type { Snapshot } from "./model.js";
import { DependencyRunError } from "./state.js";

const Required = Schema.Struct({
  context: Schema.String,
  app_id: Schema.NullOr(Schema.Int),
});

const Rule = Schema.Struct({
  type: Schema.String,
  parameters: Schema.optionalKey(
    Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  ),
});

const RuleChecks = Schema.Struct({
  required_status_checks: Schema.Array(
    Schema.Struct({
      context: Schema.String,
      integration_id: Schema.optionalKey(Schema.Int),
    }),
  ),
});

const Protection = Schema.Struct({
  required_status_checks: Schema.NullOr(
    Schema.Struct({
      contexts: Schema.Array(Schema.String),
      checks: Schema.Array(Required),
    }),
  ),
  required_pull_request_reviews: Schema.NullOr(Schema.Unknown),
});

/** Discover effective hosted requirements; red or pending base checks are report data. */
export const dependencyCheckRequirements = Effect.fn(
  "Dependencies.checkRequirements",
)(function* (
  snapshot: Snapshot,
  config: DependencyConfig,
  allowBypass: boolean,
  timeout: number,
) {
  const endpoint = `repos/${snapshot.repository}`;
  const branch = encodeURIComponent(snapshot.target);

  const rules = (yield* Api.pages(
    {
      endpoint: `${endpoint}/rules/branches/${branch}`,
      method: "GET",
      query: { per_page: 100 },
      options: { timeout },
    },
    Schema.Array(Rule),
  )).flat();

  const protection = yield* Api.json(
    {
      endpoint: `${endpoint}/branches/${branch}/protection`,
      method: "GET",
      options: { timeout },
    },
    Protection,
  ).pipe(
    Effect.catchIf(
      (error) =>
        error instanceof GhCommandError &&
        /Branch not protected.*\(HTTP 404\)/i.test(error.stderr),
      () => Effect.succeed(undefined),
    ),
  );

  const required: { context: string; appId?: number }[] = [];

  for (const rule of rules) {
    if (rule.type === "required_status_checks") {
      const parameters = yield* Schema.decodeUnknownEffect(RuleChecks)(
        rule.parameters,
      );

      required.push(
        ...parameters.required_status_checks.map((check) => ({
          context: check.context,
          ...Record.filter(
            { appId: check.integration_id },
            Predicate.isNotUndefined,
          ),
        })),
      );
    } else if (rule.type === "pull_request") {
      if (!allowBypass)
        return yield* new DependencyRunError({
          message:
            "Target requires pull requests; explicit host allowBypass permission is missing",
        });
    } else if (
      ![
        "non_fast_forward",
        "deletion",
        "required_linear_history",
        "required_signatures",
      ].includes(rule.type)
    ) {
      return yield* new DependencyRunError({
        message: `Unsupported effective branch rule: ${rule.type}`,
      });
    }
  }

  if (protection?.required_pull_request_reviews && !allowBypass)
    return yield* new DependencyRunError({
      message:
        "Classic branch protection requires pull requests; explicit host allowBypass permission is missing",
    });

  for (const check of protection?.required_status_checks?.checks ?? [])
    required.push({
      context: check.context,
      ...Record.filter(
        {
          appId:
            check.app_id == null || check.app_id < 0 ? undefined : check.app_id,
        },
        Predicate.isNotUndefined,
      ),
    });

  for (const context of protection?.required_status_checks?.contexts ?? [])
    if (!required.some((check) => check.context === context))
      required.push({ context });

  if (required.length && !allowBypass)
    return yield* new DependencyRunError({
      message:
        "Direct publication with required hosted checks needs explicit host allowBypass permission; local checks do not create hosted statuses",
    });

  for (const check of required)
    if (
      !config.validation.checks.some(
        (mapping) =>
          mapping.context === check.context &&
          (check.appId === undefined || mapping.appId === check.appId),
      )
    )
      return yield* new DependencyRunError({
        message: `Missing local mapping for required check ${check.context}${check.appId === undefined ? "" : ` (app ${check.appId})`}`,
      });

  const runs = (yield* Api.pages(
    {
      endpoint: `${endpoint}/commits/${snapshot.sha}/check-runs`,
      method: "GET",
      query: { per_page: 100 },
      options: { timeout },
    },
    Schema.Struct({
      check_runs: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          status: Schema.String,
          conclusion: Schema.NullOr(Schema.String),
        }),
      ),
    }),
  )).flatMap((page) => page.check_runs);

  const statuses = (yield* Api.pages(
    {
      endpoint: `${endpoint}/commits/${snapshot.sha}/statuses`,
      method: "GET",
      query: { per_page: 100 },
      options: { timeout },
    },
    Schema.Array(
      Schema.Struct({ context: Schema.String, state: Schema.String }),
    ),
  )).flat();

  return {
    fingerprint: createHash("sha256")
      .update(JSON.stringify({ rules, protection, required }))
      .digest("hex"),
    required,
    current: [
      ...runs.map((run) => `${run.name}: ${run.conclusion ?? run.status}`),
      ...statuses.map((status) => `${status.context}: ${status.state}`),
    ],
  };
});
