import { Clock, Effect } from "effect";
import { OutputLog, formatDuration } from "../services/OutputLog.js";
import { cliStyler } from "./ansi.js";

/**
 * Format a count with its noun. Adds an `s` unless the count is one, or uses
 * `pluralWord` for irregular nouns such as `repository`.
 */
export const plural = (
  count: number,
  word: string,
  pluralWord = `${word}s`,
): string => `${count} ${count === 1 ? word : pluralWord}`;

/**
 * Log aligned `label value` lines, padding every label to the longest one.
 * Values are passed through as-is so callers can style them.
 */
export function logFields(
  fields: ReadonlyArray<readonly [label: string, value: string]>,
): Effect.Effect<void, never, OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;
    const style = cliStyler();
    const width = Math.max(0, ...fields.map(([label]) => label.length));

    for (const [label, value] of fields) {
      yield* log.info(`${style.label(label.padEnd(width))}  ${value}`);
    }
  });
}

/** Dimmed `Completed in` line for the time elapsed since `startedAt` (epoch ms). */
export const completedIn = (startedAt: number): Effect.Effect<string> =>
  Clock.currentTimeMillis.pipe(
    Effect.map((now) =>
      cliStyler().dim(`Completed in ${formatDuration(now - startedAt)}`),
    ),
  );

/**
 * Log the closing summary of a multi-step command: a section heading followed
 * by one success line per completed action, or a dimmed note when nothing ran.
 * Ends with the elapsed time when `startedAt` (epoch ms) is given.
 */
export function logRunSummary(
  title: string,
  actions: readonly string[],
  options: { readonly empty?: string; readonly startedAt?: number } = {},
): Effect.Effect<void, never, OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;

    yield* log.section(title);

    if (actions.length === 0) {
      yield* log.info(cliStyler().dim(options.empty ?? "Nothing to do"));
    }

    for (const action of actions) {
      yield* log.success(action);
    }

    if (options.startedAt !== undefined) {
      yield* log.info(yield* completedIn(options.startedAt));
    }
  });
}
