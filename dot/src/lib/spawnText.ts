import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** Captured result of a finished child process. */
export interface CapturedProcess {
  /** Process exit code. */
  readonly exitCode: number;
  /** Decoded standard output. */
  readonly stdout: string;
  /** Decoded standard error. */
  readonly stderr: string;
}

/**
 * Run a command to completion with stdin closed and capture its output and
 * exit code. A non-zero exit code is returned, not failed.
 */
export const spawnCaptured = Effect.fn("spawnText.captured")(function* (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string } = {},
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(command, args, { cwd: options.cwd, stdin: "ignore" }),
      );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );

      return { exitCode: Number(exitCode), stdout, stderr };
    }),
  );
});
