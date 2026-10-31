import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/** Captured output of a bounded command; code -1 when it failed to run or timed out. */
export interface QueryResult {
  /** Exit code. */
  readonly code: number;
  /** Standard output. */
  readonly stdout: string;
  /** Standard error. */
  readonly stderr: string;
}

/** Run a command with no stdin, capturing its output, within a timeout in seconds. */
export const query = Effect.fn("BoundedQuery.query")(function* (
  command: string,
  args: readonly string[],
  timeout: number,
  cwd?: string,
  env?: Readonly<Record<string, string>>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  return yield* Effect.gen(function* () {
    const child = yield* spawner.spawn(
      ChildProcess.make(command, args, {
        stdin: "ignore",
        ...(cwd && { cwd }),
        ...(env && { env: { ...env }, extendEnv: true }),
      }),
    );

    const result: QueryResult = yield* Effect.all(
      {
        code: child.exitCode.pipe(Effect.map(Number)),
        stdout: child.stdout.pipe(Stream.decodeText(), Stream.mkString),
        stderr: child.stderr.pipe(Stream.decodeText(), Stream.mkString),
      },
      { concurrency: "unbounded" },
    );

    return result;
  }).pipe(
    Effect.scoped,
    Effect.timeout(`${timeout} seconds`),
    Effect.catch((error) =>
      Effect.succeed<QueryResult>({
        code: -1,
        stdout: "",
        stderr: String(error),
      }),
    ),
  );
});

/** Non-empty trimmed lines of command output. */
export const lines = (output: string) =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
