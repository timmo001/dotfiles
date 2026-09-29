import { NodeServices } from "@effect/platform-node";
import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export const runText = (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string } = {},
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const proc = yield* spawner.spawn(
      ChildProcess.make(command, args, {
        ...options,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      }),
    );

    const output = yield* proc.stdout.pipe(Stream.decodeText(), Stream.mkString);
    const exitCode = yield* proc.exitCode;

    if (exitCode !== 0) {
      return yield* Effect.fail(new Error(`${command} exited ${exitCode}`));
    }

    return output;
  }).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    Effect.mapError((error) => (error instanceof Error ? error : new Error(String(error)))),
  );
