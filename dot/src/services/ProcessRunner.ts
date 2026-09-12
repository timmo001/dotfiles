import { Context, Deferred, Effect, Layer, Option, Schema } from "effect";
import { constants } from "node:os";

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

const missingProcess = Schema.is(
  Schema.Struct({ code: Schema.Literal("ESRCH") }),
);

const signalGroup = Effect.fn("ProcessRunner.signalGroup")(
  (pid: number, signal: NodeJS.Signals | 0) =>
    Effect.try({
      try: () => {
        try {
          process.kill(-pid, signal);

          return true;
        } catch (error) {
          if (missingProcess(error)) return false;
          throw error;
        }
      },
      catch: (error) => new ProcessRunError({ message: String(error) }),
    }),
);

/** Effect service for {@link ProcessRunnerService}. */
export class ProcessRunner extends Context.Service<
  ProcessRunner,
  ProcessRunnerService
>()("dot/ProcessRunner") {
  /** Own Bun subprocesses directly so both waiting and cleanup stay bounded. */
  static readonly layer = Layer.succeed(ProcessRunner, {
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

      const child = yield* Effect.acquireRelease(
        Effect.try({
          try: () =>
            Bun.spawn([command, ...args], {
              stdin: "inherit",
              stdout: "inherit",
              stderr: "inherit",
              detached: true,
            }),
          catch: (error) => new ProcessRunError({ message: String(error) }),
        }),
        (child) =>
          Effect.gen(function* () {
            if (!(yield* signalGroup(child.pid, "SIGTERM"))) return;

            const stopped = yield* Effect.gen(function* () {
              while (yield* signalGroup(child.pid, 0))
                yield* Effect.sleep("50 millis");
            }).pipe(Effect.timeoutOption(options.killAfter));

            if (Option.isNone(stopped))
              yield* signalGroup(child.pid, "SIGKILL");

            const exited = yield* Effect.promise(() => child.exited).pipe(
              Effect.timeoutOption("1 second"),
            );

            if (Option.isNone(exited)) {
              console.error(
                `dot run: process ${child.pid} has not exited after SIGKILL`,
              );
            }
          }).pipe(
            Effect.orDie,
            Effect.ensuring(Effect.sync(() => child.unref())),
          ),
      );

      return yield* Effect.raceFirst(
        Effect.tryPromise({
          try: () => child.exited,
          catch: (error) => new ProcessRunError({ message: String(error) }),
        }).pipe(
          Effect.map((exitCode) =>
            child.signalCode === null
              ? exitCode
              : 128 + constants.signals[child.signalCode],
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
  });
}
