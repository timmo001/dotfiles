import { Context, Effect, Layer, Schema, Stream } from "effect";
import type { CliRenderer } from "@opentui/core";
import { CommandExecutor, CommandError } from "./CommandExecutor.js";
import { OutputLog } from "./OutputLog.js";
import { waitForKeypress } from "../lib/terminal.js";
import { ENV, envString } from "../lib/env.js";

const DEBUG = !!envString(ENV.DOT_DEBUG);
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:Launcher] ${msg}`);
};

/** Domain error for launcher operations */
export class LauncherError extends Schema.TaggedErrorClass<LauncherError>()(
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
  /**
   * Suspend the TUI (if present), run a command with inherited stdio, resume.
   * In CLI mode, runs with inherited stdio directly.
   */
  readonly suspend: (
    cmd: string,
    opts?: { readonly waitForKey?: boolean },
  ) => Effect.Effect<void, LauncherError>;

  /**
   * Suspend the TUI (if present), run an argument vector without a shell, and
   * resume. In CLI mode, runs with inherited stdio directly.
   */
  readonly suspendArgv: (
    command: CommandArgv,
    opts?: { readonly waitForKey?: boolean; readonly cwd?: string },
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
  /**
   * TUI layer: suspend/resume the renderer for interactive commands,
   * stream output through OutputLog for background commands.
   */
  static tuiLayer(renderer: CliRenderer) {
    return Layer.effect(
      Launcher,
      Effect.gen(function* () {
        const executor = yield* CommandExecutor;
        const outputLog = yield* OutputLog;

        const suspendInherited = (
          command: string,
          args: readonly string[],
          displayCommand: string,
          opts?: { readonly waitForKey?: boolean; readonly cwd?: string },
        ) =>
          Effect.gen(function* () {
            log(`Suspending for: ${displayCommand}`);
            renderer.suspend();
            renderer.currentRenderBuffer.clear();

            try {
              const exitCode = yield* catchLauncherDefect(
                executor.inherit(command, args, { cwd: opts?.cwd }),
                displayCommand,
              );

              if (opts?.waitForKey) {
                yield* Effect.promise(() =>
                  waitForKeypress(
                    "\n\x1b[90mPress any key to continue...\x1b[0m",
                  ),
                );
              }

              if (exitCode !== 0) {
                return yield* new LauncherError({
                  message: `Command failed: ${displayCommand}`,
                  exitCode,
                });
              }
            } finally {
              renderer.currentRenderBuffer.clear();
              renderer.resume();
              renderer.requestRender();
              log("Resumed after command");
            }
          });

        return {
          suspend: (cmd, opts) =>
            suspendInherited("bash", ["-c", cmd], cmd, opts),

          suspendArgv: ([command, ...args], opts) => {
            const displayCommand = [command, ...args].join(" ");
            return suspendInherited(command, args, displayCommand, opts);
          },

          stream: (cmd, opts) =>
            Effect.gen(function* () {
              log(`Streaming: ${cmd}`);
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
              log(`Silent: ${cmd}`);
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

  /**
   * CLI layer: no renderer involved. Commands run directly with inherited IO
   * or stream through OutputLog to stdout.
   */
  static readonly cliLayer = Layer.effect(
    Launcher,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      const outputLog = yield* OutputLog;

      return {
        suspend: (cmd, _opts) =>
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

        suspendArgv: ([command, ...args], _opts) =>
          Effect.gen(function* () {
            log(`Running (CLI): ${[command, ...args].join(" ")}`);
            const displayCommand = [command, ...args].join(" ");
            const exitCode = yield* catchLauncherDefect(
              executor.inherit(command, args, { cwd: _opts?.cwd }),
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
