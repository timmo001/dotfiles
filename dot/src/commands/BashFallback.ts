import { Effect } from "effect";
import { Launcher } from "../services/Launcher.js";

const log = (msg: string) => console.error(`[dot:BashFallback] ${msg}`);

/**
 * Fall back to the legacy bash script for unported commands.
 *
 * Runs `dot-legacy <subcommand> <args...>` via Launcher.suspend
 * with inherited stdio so the user sees all output directly.
 */
export const bashFallback = (subcommand: string, args: readonly string[]) =>
  Effect.gen(function* () {
    const launcher = yield* Launcher;
    const fullCmd = ["dot-legacy", subcommand, ...args].join(" ");
    log(`Falling back to: ${fullCmd}`);
    yield* launcher.suspend(fullCmd, { waitForKey: false });
  });
