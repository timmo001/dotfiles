import {
  HerdrSdk,
  herdrSdkLayerFromOptions,
  type Agent,
  type Workspace,
} from "@timmo001/effect-herdr";
import { Duration, Effect, Option, Schema } from "effect";
import { ENV, envString } from "../lib/env.js";
import { DEFAULT_SOCKET_PATH } from "./HerdrRepoOpen.js";
import {
  getOpenCode,
  SESSION_ID_PATTERN,
  sessionStatus,
  SessionStatusError,
} from "./SessionStatus.js";

/** Herdr's socket client, with a short timeout so a missing Herdr fails fast. */
export const herdrLayer = () =>
  herdrSdkLayerFromOptions({
    socketPath: envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH,
    requestTimeout: Duration.seconds(5),
  });

/** Herdr's workspaces and agents, read once. */
export interface HerdrSnapshot {
  readonly workspaces: readonly Workspace[];
  readonly agents: readonly Agent[];
}

const emptySnapshot = { workspaces: [], agents: [] } satisfies HerdrSnapshot;

/** Read Herdr's workspaces and agents, or nothing when Herdr isn't reachable. */
export const herdrSnapshot = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;

  return yield* Effect.all(
    { workspaces: herdr.workspaces.list(), agents: herdr.agents.list() },
    { concurrency: 2 },
  );
}).pipe(
  Effect.provide(herdrLayer()),
  Effect.catchCause(() => Effect.succeed<HerdrSnapshot>(emptySnapshot)),
  Effect.withSpan("currentSession.herdrSnapshot"),
);

/** The OpenCode session ID Herdr reports for an agent pane. */
export const openCodeSession = (agent: Agent) =>
  Option.getOrUndefined(
    Option.filter(
      agent.agentSession,
      (session) => session.agent === "opencode" && session.kind === "id",
    ),
  )?.value;

/**
 * The calling agent's session: `$OPENCODE_SESSION_ID`, which OpenCode sets
 * for its shell and Code Mode tools, else the OpenCode session Herdr reports
 * for this pane. `undefined` when neither names one.
 */
export const currentSessionId = Effect.fn("currentSession.id")(function* (
  snapshot?: HerdrSnapshot,
) {
  const fromEnv = envString(ENV.OPENCODE_SESSION_ID);

  if (fromEnv && SESSION_ID_PATTERN.test(fromEnv)) return fromEnv;

  const ownPane = envString(ENV.HERDR_PANE_ID);

  if (!ownPane) return undefined;

  const { agents } = snapshot ?? (yield* herdrSnapshot);
  const own = agents.find((agent) => agent.paneId === ownPane);

  return own ? openCodeSession(own) : undefined;
});

const NO_SESSION =
  "No current OpenCode session: $OPENCODE_SESSION_ID isn't set and Herdr doesn't report one for this pane; pass the session ID";

/** The given session ID, or the current one, failing when there is neither. */
export const sessionIdOrCurrent = Effect.fn("currentSession.idOrCurrent")(
  function* (sessionId: Option.Option<string>) {
    if (Option.isSome(sessionId)) return sessionId.value;

    const current = yield* currentSessionId();

    if (!current)
      return yield* new SessionStatusError({
        message: NO_SESSION,
        exitCode: 2,
      });

    return current;
  },
);

const Session = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String,
    title: Schema.optionalKey(Schema.String),
    location: Schema.Struct({ directory: Schema.String }),
  }),
});

/** Print the current OpenCode session's ID, or its ID, title and directory as JSON. */
export const sessionCurrent = Effect.fn("sessionCurrent")(
  function* (options: { readonly json: boolean }) {
    const sessionId = yield* sessionIdOrCurrent(Option.none());

    if (!options.json) {
      console.log(sessionId);

      return;
    }

    const { data } = yield* getOpenCode(`/api/session/${sessionId}`, Session);

    console.log(
      JSON.stringify({
        sessionId: data.id,
        title: data.title ?? null,
        directory: data.location.directory,
      }),
    );
  },
  Effect.catchTag("SessionStatusError", (error) =>
    Effect.sync(() => {
      console.error(error.message);
      process.exitCode = error.exitCode;
    }),
  ),
);

/** {@link sessionStatus} for the given session, or the current one without an ID. */
export const sessionStatusOrCurrent = (options: {
  readonly sessionId: Option.Option<string>;
  readonly warnAt: number;
  readonly json: boolean;
}) =>
  sessionIdOrCurrent(options.sessionId).pipe(
    Effect.flatMap((sessionId) => sessionStatus({ ...options, sessionId })),
    Effect.catchTag("SessionStatusError", (error) =>
      Effect.sync(() => {
        console.error(error.message);
        process.exitCode = error.exitCode;
      }),
    ),
  );
