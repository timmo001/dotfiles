/**
 * @file The dot daemon's RPC protocol, served over a Unix socket as NDJSON.
 */

import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { PendingStatus } from "../lib/pendingUpdates.js";
import { UpdatesSnapshot } from "../lib/updatesSnapshot.js";

/** A refresh couldn't run its checks. */
export class UpdatesCheckError extends Schema.TaggedError<UpdatesCheckError>()(
  "UpdatesCheckError",
  { message: Schema.String },
) {}

/** The update status, or null before the first check has finished. */
export const CurrentUpdates = Schema.NullOr(UpdatesSnapshot);

/** Every call the dot daemon answers. */
export class DaemonRpcs extends RpcGroup.make(
  Rpc.make("GetUpdates", { success: CurrentUpdates }),
  // The current status, then the status again after each change.
  Rpc.make("WatchUpdates", { success: CurrentUpdates, stream: true }),
  // Runs the checks now, waiting for any refresh already running first.
  Rpc.make("RefreshUpdates", {
    payload: Schema.Struct({
      /** Keep the package and Omarchy status instead of checking them. */
      quick: Schema.Boolean,
      /** Respect the AUR request backoff. */
      scheduled: Schema.Boolean,
      /** Maximum duration of each external check, in seconds. */
      timeout: Schema.Int,
    }),
    success: UpdatesSnapshot,
    error: UpdatesCheckError,
  }),
  // Replaces the status with one checked elsewhere, such as by dot up.
  Rpc.make("PublishUpdates", {
    payload: Schema.Struct({ status: PendingStatus }),
    success: UpdatesSnapshot,
  }),
) {}
