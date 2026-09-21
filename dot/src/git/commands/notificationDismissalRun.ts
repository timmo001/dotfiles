import { Cause, Effect, Fiber, Queue, Ref, Stream } from "effect";
import type {
  GitNotificationCategory,
  GitNotificationDismissal,
  GitNotificationReview,
} from "../../types.js";
import type { GitNotifications } from "../services/GitNotifications.js";

/** Progress for the finite set of dismissal actions accepted during one review. */
export interface NotificationDismissProgress {
  /** Number of notifications the user queued. */
  readonly queued: number;
  /** Notifications currently being revalidated or dismissed. */
  readonly active: readonly GitNotificationReview[];
  /** Completed API outcomes, including changed evidence and failures. */
  readonly outcomes: readonly GitNotificationDismissal[];
}

/** Process up to two dismissals concurrently; enqueue returns before GitHub completes the work. */
export const startNotificationDismissalRun = Effect.fn(
  "notifications.startDismissalRun",
)(function* (notifications: Pick<GitNotifications["Service"], "dismiss">) {
  const jobs = yield* Queue.unbounded<
    {
      readonly entry: GitNotificationReview;
      readonly category: GitNotificationCategory;
    },
    Cause.Done
  >();

  const updates = yield* Queue.sliding<void>(1);

  const progress = yield* Ref.make<NotificationDismissProgress>({
    queued: 0,
    active: [],
    outcomes: [],
  });

  yield* Effect.addFinalizer(() => Queue.shutdown(jobs));
  yield* Effect.addFinalizer(() => Queue.shutdown(updates));

  const update = Effect.fn("notifications.updateProgress")(function* (
    change: (value: NotificationDismissProgress) => NotificationDismissProgress,
  ) {
    yield* Ref.update(progress, change);
    yield* Queue.offer(updates, undefined);
  });

  const worker = yield* Stream.fromQueue(jobs).pipe(
    Stream.mapEffect(
      ({ entry, category }) =>
        Effect.gen(function* () {
          yield* update((value) => ({
            ...value,
            active: [...value.active, entry],
          }));
          const outcomes = yield* notifications.dismiss([entry], category);
          yield* update((value) => ({
            ...value,
            active: value.active.filter(
              (active) => active.thread.id !== entry.thread.id,
            ),
            outcomes: [...value.outcomes, ...outcomes],
          }));
        }),
      { concurrency: 2, unordered: true },
    ),
    Stream.runDrain,
    Effect.forkScoped,
  );

  return {
    updates,
    snapshot: Ref.get(progress),
    enqueue: Effect.fn("notifications.enqueueDismissals")(function* (
      entries: readonly GitNotificationReview[],
      category: GitNotificationCategory,
    ) {
      yield* update((value) => ({
        ...value,
        queued: value.queued + entries.length,
      }));
      yield* Queue.offerAll(
        jobs,
        entries.map((entry) => ({ entry, category })),
      );
    }),
    close: Queue.end(jobs),
    finished: Fiber.join(worker).pipe(Effect.andThen(Ref.get(progress))),
  };
});

/** Scoped dismissal workers and their latest progress. */
export type NotificationDismissalRun = Effect.Success<
  ReturnType<typeof startNotificationDismissalRun>
>;
