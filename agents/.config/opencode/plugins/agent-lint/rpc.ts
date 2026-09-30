/**
 * @file RPC contract shared by the agent-lint server and TUI plugins.
 */

import type { Rpc } from "@opencode/schema/rpc";
import { Schema } from "effect";

/** Source tag on agent-lint inbox items. */
export const SOURCE = "agent-lint";

/** One failed command, stored on the waiting inbox item for the lint view. */
export const LintCheck = Schema.Struct({
  /** Shell-quoted command as the user would type it. */
  command: Schema.String,
  /** Combined output, in arrival order. */
  output: Schema.String,
});

/** A failed lint command and its output. */
export type LintCheck = typeof LintCheck.Type;

const Status = Schema.Struct({
  sessionID: Schema.String,
  /** Lint commands are running for the latest agent run. */
  running: Schema.Boolean,
  /** The latest run finished with every command passing or skipped. */
  clean: Schema.Boolean,
  /** Commands that timed out in the latest run; never sent to the agent. */
  timedOut: Schema.Array(Schema.String),
});

/** Lint state of one session, as shown to the user. */
export type LintStatus = typeof Status.Type;

/** Status of a session with no lint result yet. */
export const idleStatus = (sessionID: string): LintStatus => ({
  sessionID,
  running: false,
  clean: false,
  timedOut: [],
});

/** Lets the TUI read and follow per-session lint state. */
export const AgentLintRpc = {
  id: "agent-lint",
  methods: {
    status: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })),
      output: Schema.toStandardSchemaV1(Status),
    },
  },
  events: {
    status: { schema: Schema.toStandardSchemaV1(Status) },
  },
} as const satisfies Rpc.PortableDefinition;
