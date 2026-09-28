import { Clock, Effect, Schedule, Schema } from "effect";
import { join } from "node:path";
import { HOME_DIR } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

const Count = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
);

const ModelRef = Schema.Struct({
  providerID: Schema.String,
  id: Schema.String,
  variant: Schema.optionalKey(Schema.String),
});

const Tokens = Schema.Struct({
  input: Count,
  output: Count,
  reasoning: Count,
  cache: Schema.Struct({ read: Count, write: Count }),
});

const Session = Schema.Struct({
  id: Schema.String,
  title: Schema.optionalKey(Schema.String),
  agent: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(ModelRef),
  location: Schema.Struct({ directory: Schema.String }),
  time: Schema.Struct({
    created: Count,
    updated: Count,
    idle: Schema.optionalKey(Count),
  }),
  tokens: Tokens,
  cost: Count,
  revert: Schema.optionalKey(Schema.Struct({ messageID: Schema.String })),
});

const Message = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  time: Schema.Struct({ created: Count, completed: Schema.optionalKey(Count) }),
  model: Schema.optionalKey(ModelRef),
  tokens: Schema.optionalKey(Tokens),
  status: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
});

const MessagePage = Schema.Struct({
  data: Schema.Array(Message),
  cursor: Schema.Struct({
    next: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});

const Catalogue = Schema.Struct({
  location: Schema.Struct({ directory: Schema.String }),
  data: Schema.Array(
    Schema.Struct({
      providerID: Schema.String,
      id: Schema.String,
      name: Schema.String,
      limit: Schema.Struct({
        context: Count,
        input: Schema.optionalKey(Count),
        output: Count,
      }),
      variants: Schema.Array(Schema.Struct({ id: Schema.String })),
    }),
  ),
});

/** Failure to read an explicitly identified OpenCode session. */
export class SessionStatusError extends Schema.TaggedError<SessionStatusError>()(
  "SessionStatusError",
  { message: Schema.String, exitCode: Schema.Literal(2) },
) {}

const get = Effect.fn("sessionStatus.get")(function* <A, I>(
  path: string,
  schema: Schema.Codec<A, I>,
  directory?: string,
) {
  const executor = yield* CommandExecutor;

  const output = yield* executor.run(
    join(HOME_DIR, ".local", "bin", "opencode2"),
    ["api", "get", path],
    { cwd: directory },
  );

  return yield* Schema.decodeEffect(Schema.fromJsonString(schema))(output).pipe(
    Effect.mapError(
      () =>
        new SessionStatusError({
          message: `Invalid or incomplete OpenCode response for ${path.split("?")[0]}`,
          exitCode: 2,
        }),
    ),
  );
});

// One message per page avoids fetching a whole transcript just to read usage.
const latest = Effect.fn("sessionStatus.latest")(function* (
  sessionId: string,
  type: "assistant" | "compaction",
  accept: (message: typeof Message.Type) => boolean,
  directory: string,
) {
  let cursor: string | undefined;
  const seen = new Set<string>();

  for (let scanned = 0; scanned < 20; scanned++) {
    const query = new URLSearchParams({
      type,
      limit: "1",
      ...(cursor ? { cursor } : { order: "desc" }),
    });

    const page = yield* get(
      `/api/session/${sessionId}/message?${query}`,
      MessagePage,
      directory,
    );

    const message = page.data.find(accept);

    if (message) return { message, complete: true };

    if (!page.data.length || !page.cursor.next)
      return { message: null, complete: true };

    if (seen.has(page.cursor.next)) break;
    seen.add(page.cursor.next);
    cursor = page.cursor.next;
  }

  return { message: null, complete: false };
});

function modelName(model: typeof ModelRef.Type | null | undefined) {
  return model
    ? `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}`
    : "unknown";
}

/** Read model selection and a labelled context-usage snapshot without changing the session. */
export const readSessionStatus = Effect.fn("readSessionStatus")(function* (
  sessionId: string,
  warnAt: number,
) {
  if (!/^ses[a-zA-Z0-9_-]+$/.test(sessionId))
    return yield* new SessionStatusError({
      message:
        "Use the exact OpenCode session ID from the injected environment context",
      exitCode: 2,
    });

  const { data: session } = yield* get(
    `/api/session/${sessionId}`,
    Schema.Struct({ data: Session }),
  );

  if (session.id !== sessionId)
    return yield* new SessionStatusError({
      message: "OpenCode returned a different session",
      exitCode: 2,
    });

  const { catalogue, compaction, usage } = yield* Effect.all(
    {
      catalogue: get(
        `/api/model?location%5Bdirectory%5D=${encodeURIComponent(session.location.directory)}`,
        Catalogue,
        session.location.directory,
      ).pipe(
        Effect.repeat({
          until: (catalogue) => catalogue.data.length > 0,
          schedule: Schedule.spaced("250 millis"),
          times: 20,
        }),
      ),
      compaction: latest(
        sessionId,
        "compaction",
        (message) => message.status === "completed",
        session.location.directory,
      ),
      usage: latest(
        sessionId,
        "assistant",
        (message) =>
          message.time.completed !== undefined &&
          message.tokens !== undefined &&
          message.model !== undefined,
        session.location.directory,
      ),
    },
    { concurrency: 3 },
  );

  if (catalogue.location.directory !== session.location.directory)
    return yield* new SessionStatusError({
      message: "OpenCode returned a model catalogue for another directory",
      exitCode: 2,
    });

  const measuredAt = yield* Clock.currentTimeMillis;

  const selected = catalogue.data.find(
    (model) =>
      model.id === session.model?.id &&
      model.providerID === session.model.providerID,
  );

  const message = usage.message;

  const recordedModel = catalogue.data.find(
    (model) =>
      model.id === message?.model?.id &&
      model.providerID === message.model.providerID,
  );

  const tokens = message?.tokens;

  const inputTokens = tokens
    ? tokens.input + tokens.cache.read + tokens.cache.write
    : null;

  const usedTokens = tokens
    ? tokens.input +
      tokens.cache.read +
      tokens.cache.write +
      tokens.output +
      tokens.reasoning
    : null;

  const afterCompaction =
    compaction.complete &&
    (!compaction.message ||
      (message !== null &&
        message.time.created > compaction.message.time.created));

  const sameModel =
    message?.model !== undefined &&
    session.model !== undefined &&
    message.model.providerID === session.model.providerID &&
    message.model.id === session.model.id &&
    (message.model.variant ?? "default") ===
      (session.model.variant ?? "default");

  const usable =
    afterCompaction &&
    sameModel &&
    session.revert === undefined &&
    usedTokens !== null &&
    usedTokens > 0;

  const percent =
    usable && selected?.limit.context
      ? (usedTokens / selected.limit.context) * 100
      : null;

  const inputPercent =
    usable && inputTokens !== null && selected?.limit.input
      ? (inputTokens / selected.limit.input) * 100
      : null;

  const pressurePercent =
    percent === null && inputPercent === null
      ? null
      : Math.max(percent ?? 0, inputPercent ?? 0);

  const notes = [
    "Context usage is the latest recorded request plus its output, not a live token count. Later tool results and messages may add tokens.",
    "The warning threshold is a workflow heuristic, not a measured loss of model capability.",
  ];

  if (!usage.complete || !compaction.complete)
    notes.push(
      "Recent-message lookup reached its scan limit; older evidence was not inspected.",
    );

  if (!message)
    notes.push("No completed assistant response with usage was found.");

  if (message && !sameModel)
    notes.push(
      "The recorded response used a different model or variant from the current selection.",
    );

  if (compaction.message && !afterCompaction)
    notes.push(
      "No usage measurement is available after the latest completed compaction.",
    );

  if (session.revert)
    notes.push(
      "A staged revert changes the context boundary; current context usage is unknown.",
    );

  if (!selected)
    notes.push(
      "The selected model is absent from the current project catalogue; its limits are unknown.",
    );

  return {
    sessionId,
    title: session.title ?? null,
    agent: session.agent ?? null,
    directory: session.location.directory,
    sampledAt: new Date(measuredAt).toISOString(),
    sessionTime: session.time,
    model: session.model ?? null,
    modelName: selected?.name ?? null,
    availableVariants: selected?.variants.map((variant) => variant.id) ?? [],
    limits: selected?.limit ?? null,
    context: {
      source: "latest-completed-assistant-usage",
      usedTokens: usable ? usedTokens : null,
      windowTokens: selected?.limit.context ?? null,
      percent: percent === null ? null : Math.round(percent * 10) / 10,
      remainingTokens:
        usable && selected?.limit.context
          ? Math.max(0, selected.limit.context - usedTokens)
          : null,
      warnAtPercent: warnAt,
      inputTokens: usable ? inputTokens : null,
      inputLimitTokens: selected?.limit.input ?? null,
      inputPercent:
        inputPercent === null ? null : Math.round(inputPercent * 10) / 10,
      remainingInputTokens:
        usable && inputTokens !== null && selected?.limit.input
          ? Math.max(0, selected.limit.input - inputTokens)
          : null,
      limitingBudget:
        pressurePercent === null
          ? null
          : (inputPercent ?? 0) > (percent ?? 0)
            ? "input"
            : "context",
      pressure:
        pressurePercent === null
          ? "unknown"
          : pressurePercent >= 100
            ? "at-limit"
            : pressurePercent >= warnAt
              ? "review"
              : "below-threshold",
      measurement: message
        ? {
            messageId: message.id,
            completedAt: message.time.completed ?? null,
            ageSeconds: Math.max(
              0,
              Math.floor(
                (measuredAt -
                  (message.time.completed ?? message.time.created)) /
                  1000,
              ),
            ),
            model: message.model,
            tokens,
            inputTokens,
            usedTokens,
            windowTokens: recordedModel?.limit.context ?? null,
          }
        : null,
    },
    lastCompaction: compaction.message
      ? {
          messageId: compaction.message.id,
          createdAt: compaction.message.time.created,
          reason: compaction.message.reason ?? null,
        }
      : null,
    cumulative: { tokens: session.tokens, costUsd: session.cost },
    notes,
  };
});

/** Print a session's model, usage and context pressure for people or scripts. */
export const sessionStatus = Effect.fn("sessionStatus")(
  function* (options: {
    readonly sessionId: string;
    readonly warnAt: number;
    readonly json: boolean;
  }) {
    const report = yield* readSessionStatus(
      options.sessionId,
      options.warnAt,
    ).pipe(Effect.timeout("90 seconds"));

    if (options.json) {
      console.log(JSON.stringify(report));

      return;
    }

    console.log(
      [
        `Session: ${report.sessionId}${report.title ? ` (${report.title})` : ""}`,
        `Directory: ${report.directory}`,
        `Agent: ${report.agent ?? "unknown"}`,
        `Model: ${modelName(report.model)}`,
        `Variants: ${report.availableVariants.join(", ") || "none listed"}`,
        `Limits: context ${report.limits?.context ?? "unknown"}, input ${report.limits?.input ?? "unspecified"}, output ${report.limits?.output ?? "unknown"}`,
        `Context: ${report.context.usedTokens ?? "unknown"} tokens / ${report.context.windowTokens ?? "unknown"} (${report.context.percent === null ? "unknown" : `${report.context.percent}%`}); ${report.context.pressure}`,
        `Remaining: ${report.context.remainingTokens ?? "unknown"} tokens; review threshold ${report.context.warnAtPercent}%`,
        `Input: ${report.context.inputTokens ?? "unknown"} / ${report.context.inputLimitTokens ?? "unspecified"} tokens (${report.context.inputPercent === null ? "unknown" : `${report.context.inputPercent}%`}); remaining ${report.context.remainingInputTokens ?? "unknown"}`,
        `Limiting budget: ${report.context.limitingBudget ?? "unknown"}`,
        `Measurement: ${report.context.measurement ? `${report.context.measurement.messageId}, ${report.context.measurement.ageSeconds}s old, ${modelName(report.context.measurement.model)}` : "unavailable"}`,
        `Last compaction: ${report.lastCompaction ? `${new Date(report.lastCompaction.createdAt).toISOString()} (${report.lastCompaction.reason ?? "unknown"})` : "none found"}`,
        `Cumulative usage: input ${report.cumulative.tokens.input}, cache read ${report.cumulative.tokens.cache.read}, cache write ${report.cumulative.tokens.cache.write}, output ${report.cumulative.tokens.output}, reasoning ${report.cumulative.tokens.reasoning}`,
        `Cumulative cost: $${report.cumulative.costUsd.toFixed(4)}`,
        ...report.notes,
      ].join("\n"),
    );
  },
  Effect.catchTag("SessionStatusError", (error) =>
    Effect.sync(() => {
      console.error(error.message);
      process.exitCode = error.exitCode;
    }),
  ),
);
