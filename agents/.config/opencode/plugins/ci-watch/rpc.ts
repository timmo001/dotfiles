/**
 * @file RPC contract shared by the ci-watch server and TUI plugins.
 */

import type { Rpc } from "@opencode/schema/rpc";
import { Schema } from "effect";

/** CI state of the session's checkout, from the Workflow Watch state token. */
export const CiState = Schema.Literals(["none", "loading", "running", "failure", "success", "idle", "unavailable"]);

/** CI state of the session's checkout. */
export type CiState = typeof CiState.Type;

const Status = Schema.Struct({
  sessionID: Schema.String,
  state: CiState,
  /** Pushed commit the state describes. */
  sha: Schema.NullOr(Schema.String),
  /** Failed runs, once their details have loaded. */
  failures: Schema.Number,
  /** The current failures were dismissed or already sent. */
  dismissed: Schema.Boolean,
});

/** CI state of one session, as shown to the user. */
export type CiStatus = typeof Status.Type;

/** Status of a session with no CI state. */
export const noStatus = (sessionID: string): CiStatus => ({
  sessionID,
  state: "none",
  sha: null,
  failures: 0,
  dismissed: false,
});

/** One failed run, as printed by `herdr-workflow-watch failures --json`. */
export const FailedRun = Schema.Struct({
  id: Schema.Number,
  attempt: Schema.Number,
  workflow: Schema.String,
  url: Schema.String,
  jobs: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      name: Schema.String,
      conclusion: Schema.NullOr(Schema.String),
      url: Schema.String,
      failedSteps: Schema.Array(
        Schema.Struct({
          number: Schema.Number,
          name: Schema.String,
          conclusion: Schema.NullOr(Schema.String),
        }),
      ),
    }),
  ),
  logs: Schema.NullOr(Schema.String),
  logFile: Schema.NullOr(Schema.String),
});

/** One failed run and its failed jobs, steps and logs. */
export type FailedRun = typeof FailedRun.Type;

/** Output of `herdr-workflow-watch failures --json`. */
export const Failures = Schema.Struct({
  repository: Schema.String,
  branch: Schema.String,
  sha: Schema.NullOr(Schema.String),
  runs: Schema.Array(FailedRun),
  prompt: Schema.NullOr(Schema.String),
});

/** Failed runs on a checkout's pushed commit. */
export type Failures = typeof Failures.Type;

const SessionInput = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String }));

/** Lets the TUI read and follow CI state, and act on waiting failures. */
export const CiWatchRpc = {
  id: "ci-watch",
  methods: {
    status: {
      input: SessionInput,
      output: Schema.toStandardSchemaV1(Status),
    },
    details: {
      input: SessionInput,
      output: Schema.toStandardSchemaV1(Schema.NullOr(Failures)),
    },
    dismiss: {
      input: SessionInput,
      output: Schema.toStandardSchemaV1(Schema.Null),
    },
  },
  events: {
    status: { schema: Schema.toStandardSchemaV1(Status) },
  },
} as const satisfies Rpc.PortableDefinition;
