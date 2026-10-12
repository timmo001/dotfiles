import { Effect } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";

/** Outcome of {@link runQuiet}: the exit code and the captured output. */
export interface QuietCommandResult {
  /** Process exit code, or 1 when the command could not be started. */
  readonly exitCode: number;
  /** Interleaved stdout and stderr. */
  readonly output: string;
}

/**
 * Run a command with its stdout and stderr captured, printing the output only
 * when the command fails so routine runs stay quiet.
 */
export const runQuiet = Effect.fn("runQuiet")(function* (
  cmd: string,
  args: readonly string[],
  opts?: { readonly cwd?: string },
) {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  const result: QuietCommandResult = yield* executor
    .run(cmd, args, { ...opts, mergeStderr: true })
    .pipe(
      Effect.map((output) => ({ exitCode: 0, output })),
      Effect.catchTag("CommandError", (error) =>
        Effect.succeed({
          exitCode: error.exitCode,
          output: [error.stdout, error.stderr].filter(Boolean).join("\n"),
        }),
      ),
    );

  if (result.exitCode !== 0) {
    for (const line of result.output.split("\n")) {
      if (line.trim()) yield* log.info(`  ${line}`);
    }
  }

  return result;
});
