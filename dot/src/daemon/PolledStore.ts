/**
 * @file A value the dot daemon recomputes on an interval and on request,
 * telling watchers only when it changes.
 */

import {
  Duration,
  Effect,
  Option,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";

/** The latest value, its changes, and a way to recompute it now. */
export interface PolledStore<A, E> {
  /** The latest value, or none before the first computation. */
  readonly get: Effect.Effect<Option.Option<A>>;
  /** The latest value, then each change. */
  readonly changes: Stream.Stream<Option.Option<A>>;
  /** Recompute now, after any computation already running, and return the result. */
  readonly refresh: Effect.Effect<A, E>;
}

/**
 * Compute a value now and every `every`, publishing it only when its JSON
 * changes. The schedule lives in the calling scope.
 */
export const polledStore = Effect.fn("PolledStore.make")(function* <A, E, R>(
  name: string,
  compute: Effect.Effect<A, E, R>,
  every: Duration.Input,
) {
  const ref = yield* SubscriptionRef.make(Option.none<A>());
  const lock = yield* Semaphore.make(1);
  const services = yield* Effect.context<R>();
  let published = "";

  const refresh = compute.pipe(
    Effect.tap((value) => {
      const json = JSON.stringify(value);

      if (json === published) return Effect.void;

      published = json;

      return SubscriptionRef.set(ref, Option.some(value));
    }),
    Semaphore.withPermit(lock),
    Effect.provideContext(services),
    Effect.withSpan(`${name}.refresh`),
  );

  yield* refresh.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`${name} check failed`, cause),
    ),
    Effect.andThen(Effect.sleep(every)),
    Effect.forever,
    Effect.forkScoped,
  );

  return {
    get: SubscriptionRef.get(ref),
    changes: SubscriptionRef.changes(ref),
    refresh,
  } satisfies PolledStore<A, E>;
});
