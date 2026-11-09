import {
  Cause,
  Clock,
  Console,
  Effect,
  FileSystem,
  Option,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { DaemonClient, tryDaemon } from "../daemon/Client.js";
import { formatCause } from "../lib/schema.js";
import type { PendingStatus } from "../lib/pendingUpdates.js";
import {
  barOf,
  checkSnapshot,
  readSnapshot,
  snapshotJson,
  snapshotOf,
  STALE_AFTER_MILLIS,
  updatesPaths,
  type UpdatesSnapshot,
  writeSnapshot,
} from "../lib/updatesSnapshot.js";

/** How long a status read waits for the daemon before reading the cache. */
const DAEMON_READ_TIMEOUT = "3 seconds";

/** Paths and timing controls for update refreshes. */
export interface UpdatesOptions {
  /** Status cache directory; defaults to the XDG status-bar cache. */
  readonly cacheDir?: string;
  /** Maximum duration of each external check, in seconds. */
  readonly timeout: number;
}

const printSnapshot = (snapshot: UpdatesSnapshot | undefined, json: boolean) =>
  Console.log(JSON.stringify(json ? snapshotJson(snapshot) : barOf(snapshot)));

/**
 * Refresh the update status. The dot daemon runs it when it answers, and its
 * watchers see the result; otherwise it runs here, under a lock shared with
 * other refreshes, and updates the cache. `quick` keeps the cached package and Omarchy status, for the end
 * of `dot up`; scheduled runs respect the AUR request backoff.
 */
export const updatesRefresh = Effect.fn("Updates.refresh")(function* (
  options: UpdatesOptions,
  scheduled = false,
  quick = false,
) {
  // A custom cache directory is a separate status the daemon doesn't keep.
  if (options.cacheDir === undefined) {
    const viaDaemon = yield* tryDaemon(
      Effect.gen(function* () {
        const client = yield* DaemonClient;

        return yield* client.RefreshUpdates({
          quick,
          scheduled,
          timeout: options.timeout,
        });
      }),
    );

    if (Option.isSome(viaDaemon)) return;
  }

  const fs = yield* FileSystem.FileSystem;
  const locations = updatesPaths(options.cacheDir);
  yield* fs.makeDirectory(locations.directory, { recursive: true });
  yield* Effect.acquireUseRelease(
    fs.makeDirectory(locations.lock).pipe(
      Effect.as(true),
      Effect.catchReason("PlatformError", "AlreadyExists", () =>
        Effect.succeed(false),
      ),
    ),
    (acquired) =>
      Effect.gen(function* () {
        if (!acquired) return;

        const snapshot = yield* checkSnapshot(
          {
            timeout: options.timeout,
            backoffFile: locations.backoff,
            scheduled,
            quick,
          },
          quick ? yield* readSnapshot(locations.cache) : Option.none(),
        );

        yield* writeSnapshot(locations.cache, snapshot);
      }),
    (acquired) =>
      acquired
        ? fs.remove(locations.lock, { recursive: true }).pipe(Effect.orDie)
        : Effect.void,
  );
});

/** Save a fresh full check as the status, as `dot up` does after checking. */
export const saveStatus = Effect.fn("Updates.save")(function* (
  status: PendingStatus,
) {
  const viaDaemon = yield* tryDaemon(
    Effect.gen(function* () {
      const client = yield* DaemonClient;

      return yield* client.PublishUpdates({ status });
    }),
  );

  if (Option.isSome(viaDaemon)) return;

  yield* writeSnapshot(updatesPaths().cache, yield* snapshotOf(status));
});

/**
 * Print the current status. The dot daemon answers when it runs; otherwise
 * print the cache and start a detached refresh when it is stale.
 */
export const updatesStatus = Effect.fn("Updates.status")(function* (
  json = false,
) {
  const viaDaemon = yield* tryDaemon(
    Effect.gen(function* () {
      const client = yield* DaemonClient;

      return yield* client.GetUpdates();
    }).pipe(Effect.timeout(DAEMON_READ_TIMEOUT)),
  );

  if (Option.isSome(viaDaemon))
    return yield* printSnapshot(viaDaemon.value ?? undefined, json);

  const fs = yield* FileSystem.FileSystem;
  const locations = updatesPaths();
  const now = yield* Clock.currentTimeMillis;
  const cached = yield* readSnapshot(locations.cache);

  if (
    (Option.isNone(cached) ||
      now - cached.value.packagesCheckedAt >= STALE_AFTER_MILLIS) &&
    !(yield* fs.exists(locations.lock))
  ) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    yield* spawner
      .spawn(
        ChildProcess.make(
          "dot",
          [
            "updates",
            "refresh",
            "--scheduled",
            "--cache-dir",
            locations.directory,
            "--timeout",
            "120",
          ],
          {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            detached: true,
          },
        ),
      )
      .pipe(
        Effect.flatMap((child) => child.unref),
        Effect.asVoid,
        Effect.scoped,
      );
  }

  yield* printSnapshot(Option.getOrUndefined(cached), json);
});

/**
 * Print the status from the dot daemon, then again after each change. Exits
 * 1 when the daemon can't be reached or the connection ends, so a supervisor
 * can restart it.
 */
export const updatesWatch = Effect.fn("Updates.watch")(function* (
  json: boolean,
) {
  yield* Effect.gen(function* () {
    const client = yield* DaemonClient;

    yield* client.WatchUpdates().pipe(
      Stream.map((snapshot) =>
        JSON.stringify(
          json
            ? snapshotJson(snapshot ?? undefined)
            : barOf(snapshot ?? undefined),
        ),
      ),
      Stream.changes,
      Stream.runForEach((line) => Console.log(line)),
    );
  }).pipe(
    Effect.provide(DaemonClient.layer),
    Effect.catchCause((cause) =>
      Console.error(
        Cause.hasInterruptsOnly(cause)
          ? "[ERROR] dot daemon stopped"
          : `[ERROR] dot daemon unreachable: ${formatCause(Cause.squash(cause))}`,
      ),
    ),
  );

  process.exitCode = 1;
});
