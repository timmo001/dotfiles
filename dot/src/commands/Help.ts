import { Effect } from "effect";
import { printHelp } from "../flags.js";

/**
 * Print help text to stdout. Delegates to the shared `printHelp` utility
 * which already handles subcommand-scoped help.
 */
export const help = Effect.sync(() => {
  printHelp();
});
