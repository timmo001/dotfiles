/**
 * @file RPC contract shared by the agent-lint server and TUI plugins.
 */

import type { Rpc } from "@opencode/schema/rpc";
import { Schema } from "effect";

/** One failed command, kept for the lint view and fix now. */
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
  /** Failed commands waiting for the user; only fix now sends them to the agent. */
  checks: Schema.Array(LintCheck),
  /** Instruction sent after the checks on fix now. */
  message: Schema.String,
});

/** Lint state of one session, as shown to the user. */
export type LintStatus = typeof Status.Type;

/** Status of a session with no lint result yet. */
export const idleStatus = (sessionID: string): LintStatus => ({
  sessionID,
  running: false,
  clean: false,
  timedOut: [],
  checks: [],
  message: "",
});

const SessionInput = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String }));

/** Lets the TUI read and follow per-session lint state, and drop waiting problems. */
export const AgentLintRpc = {
  id: "agent-lint",
  methods: {
    status: {
      input: SessionInput,
      output: Schema.toStandardSchemaV1(Status),
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
