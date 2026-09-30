/**
 * @file Minimal Herdr socket client: one-shot requests and workspace metadata events.
 */

import { Cause, Effect, Option, Queue, Schema, Stream } from "effect";
import { createConnection } from "node:net";

/** A workspace as reported in Herdr snapshots and metadata events. */
export const Workspace = Schema.Struct({
  workspace_id: Schema.String,
  tokens: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
  worktree: Schema.optional(Schema.NullOr(Schema.Struct({ checkout_path: Schema.String }))),
});

/** A Herdr workspace. */
export type Workspace = typeof Workspace.Type;

const Snapshot = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      snapshot: Schema.Struct({
        workspaces: Schema.Array(Workspace),
        panes: Schema.Array(
          Schema.Struct({
            workspace_id: Schema.String,
            cwd: Schema.optional(Schema.NullOr(Schema.String)),
          }),
        ),
      }),
    }),
  }),
);

/** Workspaces and panes from `session.snapshot`. */
export type Snapshot = typeof Snapshot.Type.result.snapshot;

const decodeEvent = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      event: Schema.Literal("workspace_metadata_updated"),
      data: Schema.Struct({ workspace: Workspace }),
    }),
  ),
);

interface Request {
  readonly id: string;
  readonly method: string;
  readonly params: { readonly subscriptions?: ReadonlyArray<{ readonly type: string }> };
}

// Newline-delimited JSON over the socket; the connection closes when the stream ends.
const lines = (socket: string, request: Request) =>
  Stream.callback<string, Error>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        let buffer = "";

        const client = createConnection(socket, () => client.write(`${JSON.stringify(request)}\n`));

        client.setEncoding("utf8");

        client.on("data", (chunk: string) => {
          buffer += chunk;

          for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
            Queue.offerUnsafe(queue, buffer.slice(0, index));
            buffer = buffer.slice(index + 1);
          }
        });

        client.on("error", (error) => Queue.failCauseUnsafe(queue, Cause.fail(error)));
        client.on("close", () => Queue.endUnsafe(queue));

        return client;
      }),
      (client) => Effect.sync(() => client.destroy()),
    ),
  );

/** Reads the live session snapshot. */
export const snapshot = (socket: string) =>
  lines(socket, { id: "ci-watch:snapshot", method: "session.snapshot", params: {} }).pipe(
    Stream.runHead,
    Effect.flatMap(Effect.fromOption),
    Effect.flatMap(Schema.decodeUnknownEffect(Snapshot)),
    Effect.map((response) => response.result.snapshot),
  );

/** Streams workspaces whose metadata tokens changed or were refreshed; ends when Herdr disconnects. */
export const metadataUpdates = (socket: string) =>
  lines(socket, {
    id: "ci-watch:events",
    method: "events.subscribe",
    params: { subscriptions: [{ type: "workspace.metadata_updated" }] },
  }).pipe(
    Stream.map((line) => decodeEvent(line)),
    Stream.filter(Option.isSome),
    Stream.map((event) => event.value.data.workspace),
  );
