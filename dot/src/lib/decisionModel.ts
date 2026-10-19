import { Duration, Effect, FileSystem, Schema } from "effect";
import { HttpBody, HttpClient } from "effect/http";
import { join } from "node:path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { CONFIG_DIR } from "./paths.js";

/** A decision model call failed, timed out, or its credentials are missing. */
export class DecisionModelError extends Schema.TaggedError<DecisionModelError>()(
  "DecisionModelError",
  { message: Schema.String },
) {}

/** Workers AI account and token for `@cf/` decision models, written by a secret file. */
export const WORKERS_AI_PATH = join(
  CONFIG_DIR,
  "dot",
  "brief",
  "workers-ai.yml",
);

/** One question asked of a decision model. */
export interface DecisionQuestion {
  /** `score` rates against `criteria`, `noul` checks a yes/no statement, `choice` picks one of `criteria`. */
  readonly type: "score" | "noul" | "choice";
  /** What to judge, naming fields of the state in backticks. */
  readonly instructions: string;
  /** Levels from lowest to highest for `score`, or options with descriptions for `choice`. */
  readonly criteria?: readonly string[] | Readonly<Record<string, string>>;
}

/** Credentials for decision models hosted on Workers AI. */
const WorkersAi = Schema.Struct({
  account_id: Schema.NonEmptyString,
  token: Schema.NonEmptyString,
});

/** Decoded {@link WorkersAi}. */
export interface WorkersAi extends Schema.Schema.Type<typeof WorkersAi> {}

const Decision = Schema.Struct({ answers: Schema.Unknown });

const WorkersAiDecision = Schema.Struct({ result: Decision });

const DECISION_TIMEOUT = Duration.seconds(60);

const failed = (model: string) => (error: { readonly message: string }) =>
  new DecisionModelError({ message: `${model}: ${error.message}` });

/** Read the Workers AI account and token when `model` is hosted there, otherwise `undefined`. */
export const workersAiFor = Effect.fn("decisionModel.workersAi")(function* (
  model: string,
) {
  if (!model.startsWith("@cf/")) return undefined;

  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFileString(WORKERS_AI_PATH).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(WorkersAi)),
    Effect.mapError(
      () =>
        new DecisionModelError({
          message: `${model} needs a Workers AI account_id and token in ${WORKERS_AI_PATH}`,
        }),
    ),
  );
});

/**
 * Ask a decision model `questions` about `state` and return its raw `answers`
 * object, keyed like `questions`, for the caller to decode. Models whose name
 * starts with `@cf/` run on Workers AI with `workersAi`; others run locally
 * through Ollaya.
 */
export const decide = Effect.fn("decisionModel.decide")(function* (options: {
  readonly model: string;
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
  readonly state: unknown;
  readonly workersAi: WorkersAi | undefined;
}) {
  const { model, questions, state, workersAi } = options;

  const decision = workersAi
    ? yield* HttpClient.HttpClient.pipe(
        Effect.flatMap((http) =>
          http.post(
            `https://api.cloudflare.com/client/v4/accounts/${workersAi.account_id}/ai/run`,
            {
              headers: { authorization: `Bearer ${workersAi.token}` },
              body: HttpBody.jsonUnsafe({
                model,
                input: { state, questions },
              }),
            },
          ),
        ),
        Effect.flatMap((response) => response.json),
        Effect.timeout(DECISION_TIMEOUT),
        Effect.flatMap(Schema.decodeUnknownEffect(WorkersAiDecision)),
        Effect.map((body) => body.result),
        Effect.mapError(failed(model)),
      )
    : yield* CommandExecutor.pipe(
        Effect.flatMap((executor) =>
          executor.run("ollaya", [
            "run",
            model,
            "--format",
            "json",
            "--questions",
            JSON.stringify(questions),
            "--state-json",
            JSON.stringify(state),
          ]),
        ),
        Effect.timeout(DECISION_TIMEOUT),
        Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Decision))),
        Effect.mapError(failed(model)),
      );

  return decision.answers;
});
