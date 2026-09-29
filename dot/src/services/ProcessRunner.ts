import { Context, Deferred, Effect, Layer, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { exitStatus } from "./CommandExecutor.js";

/** Failure to start, observe, or clean up an owned process group. */
export class ProcessRunError extends Schema.TaggedError<ProcessRunError>()(
  "ProcessRunError",
  { message: Schema.String },
) {}

/** The command exceeded its execution deadline. */
export class ProcessRunTimeout extends Schema.TaggedError<ProcessRunTimeout>()(
  "ProcessRunTimeout",
  { milliseconds: Schema.Finite },
) {}

/** Execution limits for one command and its process group. */
export interface ProcessRunOptions {
  /** Maximum execution time in milliseconds. */
  readonly timeout: number;
  /** Grace period before escalating SIGTERM to SIGKILL, in milliseconds. */
  readonly killAfter: number;
}

/** Bounded execution with inherited standard streams and signal cleanup. */
export interface ProcessRunnerService {
  /** Run a command, returning its exit code after releasing its process group. */
  readonly run: (
    command: string,
    args: readonly string[],
    options: ProcessRunOptions,
  ) => Effect.Effect<number, ProcessRunError | ProcessRunTimeout>;
}

/** Effect service for {@link ProcessRunnerService}. */
export class ProcessRunner extends Context.Service<
  ProcessRunner,
  ProcessRunnerService
>()("dot/ProcessRunner") {
  /**
   * Spawn each command as its own process group. Closing the scope sends the
   * group SIGTERM and escalates to SIGKILL after `killAfter`, whether the
   * command exited, timed out or dot was signalled.
   */
  static readonly layer = Layer.effect(
    ProcessRunner,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      return {
        run: Effect.fn("ProcessRunner.run")(function* (
          command: string,
          args: readonly string[],
          options: ProcessRunOptions,
        ) {
          const interrupted = yield* Deferred.make<number>();

          const onInterrupt = () =>
            Deferred.doneUnsafe(interrupted, Effect.succeed(130));

          const onTerminate = () =>
            Deferred.doneUnsafe(interrupted, Effect.succeed(143));

          const onHangup = () =>
            Deferred.doneUnsafe(interrupted, Effect.succeed(129));

          yield* Effect.acquireRelease(
            Effect.sync(() => {
              process.on("SIGINT", onInterrupt);
              process.on("SIGTERM", onTerminate);
              process.on("SIGHUP", onHangup);
            }),
            () =>
              Effect.sync(() => {
                process.off("SIGINT", onInterrupt);
                process.off("SIGTERM", onTerminate);
                process.off("SIGHUP", onHangup);
              }),
          );

          const child = yield* spawner
            .spawn(
              ChildProcess.make(command, args, {
                stdin: "inherit",
                stdout: "inherit",
                stderr: "inherit",
                detached: true,
                forceKillAfter: options.killAfter,
              }),
            )
            .pipe(
              Effect.mapError(
                (error) => new ProcessRunError({ message: String(error) }),
              ),
            );

          return yield* Effect.raceFirst(
            exitStatus(child).pipe(
              Effect.mapError(
                (error) => new ProcessRunError({ message: String(error) }),
              ),
              Effect.timeoutOrElse({
                duration: options.timeout,
                orElse: () =>
                  Effect.fail(
                    new ProcessRunTimeout({ milliseconds: options.timeout }),
                  ),
              }),
            ),
            Deferred.await(interrupted),
          );
        }, Effect.scoped),
      };
    }),
  );
}
