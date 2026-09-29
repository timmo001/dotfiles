import { Effect } from "effect";
import { OutputLog } from "../services/OutputLog.js";
import { cliStyler } from "./ansi.js";

/** Format a count with its noun, adding an `s` unless the count is one. */
export const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Log the closing summary of a multi-step command: a section heading followed
 * by one success line per completed action, or a dimmed note when nothing ran.
 */
export function logRunSummary(
  title: string,
  actions: readonly string[],
  empty = "Nothing to do",
): Effect.Effect<void, never, OutputLog> {
  return Effect.gen(function* () {
    const log = yield* OutputLog;

    yield* log.section(title);

    if (actions.length === 0) {
      yield* log.info(cliStyler().dim(empty));

      return;
    }

    for (const action of actions) {
      yield* log.success(action);
    }
  });
}
