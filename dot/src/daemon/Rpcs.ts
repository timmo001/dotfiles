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

/** A check of registered services, Git state or another status couldn't run. */
export class StatusCheckError extends Schema.TaggedError<StatusCheckError>()(
  "StatusCheckError",
  { message: Schema.String },
) {}

/**
 * Every registered job's snapshot, as `dot services status --json` prints
 * it. Each job's snapshot passes through to the services panel unchanged.
 */
export const ServicesReport = Schema.Struct({
  worst: Schema.String,
  counts: Schema.Record(Schema.String, Schema.Int),
  services: Schema.Array(Schema.Unknown),
  errors: Schema.Array(
    Schema.Struct({ file: Schema.String, message: Schema.String }),
  ),
  directory: Schema.String,
});

/** Every registered job's snapshot, as `dot services status --json` prints it. */
export type ServicesReport = typeof ServicesReport.Type;

/** One part of the Git panel: its JSON, or why it couldn't be read. */
const GitSection = Schema.Union([
  Schema.Struct({ value: Schema.Unknown }),
  Schema.Struct({ error: Schema.String }),
]);

/** One part of the Git panel: its JSON, or why it couldn't be read. */
export type GitSection = typeof GitSection.Type;

/**
 * The Git panel's state, each part as its own `--bar-json` or `--panel-json`
 * command prints it. A part is missing until it has been read once.
 */
export const GitSnapshot = Schema.Struct({
  diff: Schema.optionalKey(GitSection),
  panel: Schema.optionalKey(GitSection),
  notifications: Schema.optionalKey(GitSection),
  pullRequests: Schema.optionalKey(GitSection),
  issues: Schema.optionalKey(GitSection),
  log: Schema.optionalKey(GitSection),
});

/** The Git panel's state, each part as its own command prints it. */
export type GitSnapshot = typeof GitSnapshot.Type;

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
  // The registered services, then again after each change.
  Rpc.make("WatchServices", {
    success: Schema.NullOr(ServicesReport),
    stream: true,
  }),
  // Checks the registered services now and returns them.
  Rpc.make("RefreshServices", {
    success: ServicesReport,
    error: StatusCheckError,
  }),
  // The Git panel's state, then again after each part changes.
  Rpc.make("WatchGit", { success: GitSnapshot, stream: true }),
  // Reads every part of the Git panel again; `force` skips the PR, issue
  // and commit log caches, as the panel's refresh button does.
  Rpc.make("RefreshGit", {
    payload: Schema.Struct({ force: Schema.Boolean }),
    success: GitSnapshot,
  }),
) {}
