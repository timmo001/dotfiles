/**
 * @file RPC contract shared by the pr-reviews server and TUI plugins.
 */

import type { Rpc } from "@opencode/schema/rpc";
import { Schema } from "effect";

/** Review state of the checkout's pull request. */
export const ReviewsState = Schema.Literals(["none", "requested", "open", "clear"]);

/** Review state of the checkout's pull request. */
export type ReviewsState = typeof ReviewsState.Type;

/** One open review thread, kept for the view and fix now. */
export const OpenThread = Schema.Struct({
  id: Schema.String,
  /** `path:line`, marked when outdated. */
  location: Schema.String,
  url: Schema.String,
  comments: Schema.Array(
    Schema.Struct({
      author: Schema.String,
      body: Schema.String,
      url: Schema.String,
    }),
  ),
});

/** An open review thread and its comments. */
export type OpenThread = typeof OpenThread.Type;

const Status = Schema.Struct({
  sessionID: Schema.String,
  state: ReviewsState,
  number: Schema.NullOr(Schema.Number),
  title: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  /** Open threads waiting for the user; only fix now sends them to the agent. */
  threads: Schema.Array(OpenThread),
  /** Bots with a review still requested. */
  botRequests: Schema.Array(Schema.String),
  /** The current threads were dismissed or already sent. */
  dismissed: Schema.Boolean,
});

/** Review state of one session, as shown to the user. */
export type ReviewsStatus = typeof Status.Type;

/** Status of a session whose checkout has no pull request. */
export const noStatus = (sessionID: string): ReviewsStatus => ({
  sessionID,
  state: "none",
  number: null,
  title: null,
  url: null,
  threads: [],
  botRequests: [],
  dismissed: false,
});

const SessionInput = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String }));

/** Lets the TUI read and follow review state, and drop waiting threads. */
export const PrReviewsRpc = {
  id: "pr-reviews",
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
