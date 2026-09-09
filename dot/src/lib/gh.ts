import type { GhOptions, Interface as GhService } from "@timmo001/effect-gh";
import { Effect, Stream } from "effect";
import { CommandError } from "../services/CommandExecutor.js";
import { formatCause } from "./schema.js";

/**
 * Capture gh output through the SDK while preserving Dotfiles' command errors.
 * Consume the stream so retry classification and diagnostics retain full stderr,
 * rather than the tail retained by the SDK's buffered command error.
 */
export const ghOutput = Effect.fn("ghOutput")(function* (
  gh: GhService,
  args: readonly string[],
  options?: GhOptions,
) {
  let stdout = "";
  let stderr = "";
  yield* gh.stream(args, options).pipe(
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        if (chunk._tag === "Stdout") stdout += chunk.text;
        else stderr += chunk.text;
      }),
    ),
    Effect.mapError(
      (error) =>
        new CommandError({
          command: `gh ${args.join(" ")}`,
          exitCode: error._tag === "GhCommandError" ? error.exitCode : 1,
          stderr:
            error._tag === "GhCommandError"
              ? stderr.trim()
              : error._tag === "GhTimeoutError"
                ? `gh timed out after ${error.timeoutMs}ms`
                : formatCause(error.cause),
        }),
    ),
  );
  return stdout;
});
