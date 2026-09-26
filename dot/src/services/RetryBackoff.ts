import { Context, Duration, Effect, Layer, Schedule } from "effect";

/** Options for retrying an idempotent operation after a transient failure. */
export interface RetryBackoffOptions<E> {
  /** Initial delay, doubled on each subsequent retry. */
  readonly initial: Duration.Input;
  /** Maximum number of retries after the first attempt. */
  readonly times: number;
  /** Only these failures may be retried. */
  readonly while?: (error: E) => boolean;
  /** Upper bound on each delay. */
  readonly maxDelay?: Duration.Input;
  /** Report a scheduled retry before waiting. */
  readonly onRetry?: (
    error: E,
    delay: Duration.Duration,
  ) => Effect.Effect<void, E>;
}

/** Shared exponential retry policy for idempotent operations. */
export interface RetryBackoffService {
  /** Retry only matching typed failures, leaving exhausted failures visible. */
  readonly retry: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options: RetryBackoffOptions<E>,
  ) => Effect.Effect<A, E, R>;
}

/** Effect service for {@link RetryBackoffService}. */
export class RetryBackoff extends Context.Service<
  RetryBackoff,
  RetryBackoffService
>()("dot/RetryBackoff") {
  static readonly layer = Layer.effect(
    RetryBackoff,
    Effect.succeed(
      RetryBackoff.of({
        retry: (effect, options) => {
          const schedule = Schedule.exponential(options.initial).pipe(
            Schedule.modifyDelay(({ duration }) =>
              Effect.succeed(
                options.maxDelay
                  ? Duration.min(
                      duration,
                      Duration.fromInputUnsafe(options.maxDelay),
                    )
                  : duration,
              ),
            ),
            Schedule.setInputType<Effect.Error<typeof effect>>(),
            Schedule.tap(
              ({ input, duration }) =>
                options.onRetry?.(input, duration) ?? Effect.void,
            ),
          );

          return effect.pipe(
            Effect.retry({
              times: options.times,
              schedule,
              while: options.while,
            }),
          );
        },
      }),
    ),
  );
}
