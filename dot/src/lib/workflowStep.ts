import { Duration, Effect, Option } from "effect";
import { OutputLog } from "../services/OutputLog.js";

/** Run an effect under a timeout, returning None when the timeout fires. */
export const withTimeoutOption = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  seconds: number,
): Effect.Effect<Option.Option<A>, E, R> =>
  effect.pipe(Effect.timeoutOption(Duration.seconds(seconds)));

/** Run an effect behind the shared CLI/TUI spinner and timeout handling. */
export const withSpinnerTimeout = <A, E, R>(
  label: string,
  seconds: number,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<Option.Option<A>, E, R | OutputLog> =>
  Effect.gen(function* () {
    const log = yield* OutputLog;
    return yield* log.withSpinner(label, withTimeoutOption(effect, seconds));
  });

/**
 * Run a workflow step with the shared spinner, duration logging, and timeout.
 *
 * On timeout the running effect is interrupted, which kills child processes
 * spawned through CommandExecutor. The caller decides whether a timed-out step
 * is fatal by inspecting the returned boolean.
 */
export const withStepTimeout = <E, R>(
  label: string,
  seconds: number,
  step: Effect.Effect<void, E, R>,
): Effect.Effect<boolean, E, R | OutputLog> =>
  Effect.gen(function* () {
    const log = yield* OutputLog;
    const completed = yield* withSpinnerTimeout(label, seconds, step);
    if (Option.isNone(completed)) {
      yield* log.warn(`Step "${label}" exceeded ${seconds}s and was stopped`);
      return false;
    }
    return true;
  });
