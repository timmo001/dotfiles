import { Context, Effect, Layer, Schema, Stream } from "effect";
import { CommandExecutor, CommandError } from "./CommandExecutor.js";
import { OutputLog } from "./OutputLog.js";
import { ENV, envString } from "../lib/env.js";

const DEBUG = !!envString(ENV.DOT_DEBUG);
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:Launcher] ${msg}`);
};

/** Domain error for launcher operations */
export class LauncherError extends Schema.TaggedError<LauncherError>()(
  "LauncherError",
  {
    message: Schema.String,
    exitCode: Schema.optional(Schema.Number),
  },
) {}

/** Non-empty command argument vector for direct process execution. */
export type CommandArgv = readonly [command: string, ...args: string[]];

function catchLauncherDefect<A, E>(
  effect: Effect.Effect<A, E>,
  displayCommand: string,
): Effect.Effect<A, E | LauncherError> {
  return effect.pipe(
    Effect.catchDefect((defect) =>
      Effect.fail(
        new LauncherError({
          message: `Command failed: ${displayCommand}\n${defect instanceof Error ? defect.message : String(defect)}`,
        }),
      ),
    ),
  );
}

/** Service interface for high-level command execution with output routing */
export interface LauncherService {
  /** Run a shell command with inherited stdio. */
  readonly suspend: (cmd: string) => Effect.Effect<void, LauncherError>;

  /** Run an argument vector without a shell using inherited stdio. */
  readonly suspendArgv: (
    command: CommandArgv,
    opts?: { readonly cwd?: string },
  ) => Effect.Effect<void, LauncherError>;

  /**
   * Run a shell command, streaming each stdout line through OutputLog.
   * Returns the exit code.
   */
  readonly stream: (
    cmd: string,
    opts?: { readonly cwd?: string },
  ) => Effect.Effect<number, LauncherError>;

  /**
   * Run a command silently, capturing and returning stdout.
   */
  readonly silent: (cmd: string) => Effect.Effect<string, LauncherError>;
}

/** Effect service for {@link LauncherService} */
export class Launcher extends Context.Service<Launcher, LauncherService>()(
  "Launcher",
) {
  /** Commands run directly with inherited IO or stream through OutputLog. */
  static readonly layer = Layer.effect(
    Launcher,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      const outputLog = yield* OutputLog;

      return {
        suspend: (cmd) =>
          Effect.gen(function* () {
            log(`Running (CLI): ${cmd}`);
            const exitCode = yield* executor.inherit("bash", ["-c", cmd]);
            if (exitCode !== 0) {
              return yield* new LauncherError({
                message: `Command failed: ${cmd}`,
                exitCode,
              });
            }
          }),

        suspendArgv: ([command, ...args], opts) =>
          Effect.gen(function* () {
            log(`Running (CLI): ${[command, ...args].join(" ")}`);
            const displayCommand = [command, ...args].join(" ");
            const exitCode = yield* catchLauncherDefect(
              executor.inherit(command, args, { cwd: opts?.cwd }),
              displayCommand,
            );
            if (exitCode !== 0) {
              return yield* new LauncherError({
                message: `Command failed: ${command}`,
                exitCode,
              });
            }
          }),

        stream: (cmd, opts) =>
          Effect.gen(function* () {
            log(`Streaming (CLI): ${cmd}`);
            const lines = executor.stream("bash", ["-c", cmd], {
              cwd: opts?.cwd,
            });

            const exitRef = { code: 0 };

            yield* lines.pipe(
              Stream.runForEach((line) => outputLog.info(line)),
              Effect.catchTag("CommandError", (err: CommandError) =>
                Effect.sync(() => {
                  exitRef.code = err.exitCode;
                }),
              ),
            );

            return exitRef.code;
          }),

        silent: (cmd) =>
          Effect.gen(function* () {
            log(`Silent (CLI): ${cmd}`);
            return yield* executor.run("bash", ["-c", cmd]).pipe(
              Effect.catchTag("CommandError", (err: CommandError) =>
                Effect.fail(
                  new LauncherError({
                    message: `Command failed: ${cmd}\n${err.stderr}`,
                    exitCode: err.exitCode,
                  }),
                ),
              ),
            );
          }),
      };
    }),
  );
}
