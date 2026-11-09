/**
 * @file The dot daemon's update status: the latest snapshot, its changes, and
 * the schedule that keeps it fresh.
 */

import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import type { PendingStatus } from "../lib/pendingUpdates.js";
import {
  checkSnapshot,
  readSnapshot,
  snapshotOf,
  STALE_AFTER_MILLIS,
  updatesPaths,
  type UpdatesSnapshot,
  writeSnapshot,
} from "../lib/updatesSnapshot.js";
import { UpdatesCheckError } from "./Rpcs.js";

/** Maximum duration of each external check in a scheduled refresh, in seconds. */
const SCHEDULED_TIMEOUT_SECONDS = 120;

// Timers can stop counting while the machine sleeps, so the schedule wakes at
// least this often to compare the wall clock with the last check.
const MAX_WAIT = Duration.minutes(1);

const RETRY_AFTER_FAILURE = Duration.minutes(5);

/** How a refresh runs. */
export interface RefreshOptions {
  /** Keep the package and Omarchy status instead of checking them. */
  readonly quick: boolean;
  /** Maximum duration of each external check, in seconds. */
  readonly timeout: number;
  /** Respect the AUR request backoff. */
  readonly scheduled: boolean;
}

const make = Effect.gen(function* () {
  const paths = updatesPaths();
  const ref = yield* SubscriptionRef.make(yield* readSnapshot(paths.cache));
  const lock = yield* Semaphore.make(1);

  const services =
    yield* Effect.context<
      Effect.Services<ReturnType<typeof checkSnapshot | typeof writeSnapshot>>
    >();

  // The cache keeps the status across restarts and serves the CLI while the
  // daemon is down.
  const save = Effect.fn("UpdatesStore.save")(function* (
    snapshot: UpdatesSnapshot,
  ) {
    yield* SubscriptionRef.set(ref, Option.some(snapshot));
    yield* writeSnapshot(paths.cache, snapshot).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Couldn't write the update cache", error.message),
      ),
    );

    return snapshot;
  });

  const refresh = Effect.fn("UpdatesStore.refresh")(
    function* (options: RefreshOptions) {
      const snapshot = yield* checkSnapshot(
        { ...options, backoffFile: paths.backoff },
        yield* SubscriptionRef.get(ref),
      ).pipe(
        Effect.mapError(
          (error) => new UpdatesCheckError({ message: String(error) }),
        ),
      );

      return yield* save(snapshot);
    },
    Semaphore.withPermit(lock),
    Effect.provideContext(services),
  );

  const publish = Effect.fn("UpdatesStore.publish")(
    function* (status: PendingStatus) {
      return yield* save(yield* snapshotOf(status));
    },
    Semaphore.withPermit(lock),
    Effect.provideContext(services),
  );

  // How long until the last full check goes stale, capped so sleep can't
  // stretch it.
  const untilStale = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;

    const remaining = Option.match(yield* SubscriptionRef.get(ref), {
      onNone: () => 0,
      onSome: (snapshot) =>
        snapshot.packagesCheckedAt + STALE_AFTER_MILLIS - now,
    });

    return Duration.min(Duration.millis(Math.max(0, remaining)), MAX_WAIT);
  });

  yield* Effect.gen(function* () {
    const wait = yield* untilStale;

    if (Duration.isGreaterThan(wait, Duration.zero))
      return yield* Effect.sleep(wait);

    yield* refresh({
      quick: false,
      timeout: SCHEDULED_TIMEOUT_SECONDS,
      scheduled: true,
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Scheduled update check failed", error.message).pipe(
          Effect.andThen(Effect.sleep(RETRY_AFTER_FAILURE)),
        ),
      ),
    );
  }).pipe(Effect.forever, Effect.forkScoped);

  return {
    /** The latest snapshot, or none before the first check. */
    get: SubscriptionRef.get(ref),
    /** The latest snapshot, then each change. */
    changes: SubscriptionRef.changes(ref) satisfies Stream.Stream<
      Option.Option<UpdatesSnapshot>
    >,
    /** Run the checks now, after any refresh already running. */
    refresh,
    /** Replace the status with one checked elsewhere. */
    publish,
  };
});

/** The daemon's update status; see {@link UpdatesStoreService}. */
export class UpdatesStore extends Context.Service<
  UpdatesStore,
  UpdatesStoreService
>()("dot/daemon/UpdatesStore") {
  /** Loads the cached status and starts the refresh schedule. */
  static readonly layer = Layer.effect(UpdatesStore, make);
}

/** The latest update status, its changes, and ways to refresh or replace it. */
export type UpdatesStoreService = Effect.Success<typeof make>;
