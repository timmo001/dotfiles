import { Effect } from "effect";
import { printHelp } from "../flags.js";

/** Print help text to stdout, optionally scoped to a subcommand. */
export function help(args: readonly string[] = []) {
  return Effect.sync(() => {
    printHelp(args[0]);
  });
}
