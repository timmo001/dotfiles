import { Context, Effect, Layer, Stream } from "effect";
import type { CliRenderer } from "@opentui/core";
import { CommandExecutor, CommandError } from "./CommandExecutor.js";
import { OutputLog } from "./OutputLog.js";

const log = (msg: string) => console.error(`[dot:Launcher] ${msg}`);

/** Domain error for launcher operations */
export class LauncherError {
  readonly _tag = "LauncherError";
  constructor(
    readonly message: string,
    readonly exitCode?: number,
  ) {}
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

        return {
          suspend: (cmd, opts) =>
            Effect.gen(function* () {
              log(`Suspending for: ${cmd}`);
              renderer.suspend();
              renderer.currentRenderBuffer.clear();

              try {
                const args = ["bash", "-c", cmd];
                const exitCode = yield* executor.inherit("bash", ["-c", cmd]);

                if (opts?.waitForKey) {
                  yield* Effect.promise(
                    () =>
                      new Promise<void>((resolve) => {
                        process.stdout.write(
                          "\n\x1b[90mPress any key to continue...\x1b[0m",
                        );
                        const wasRaw = process.stdin.isRaw;
                        if (process.stdin.isTTY) process.stdin.setRawMode(true);
                        process.stdin.resume();
                        process.stdin.once("data", () => {
                          if (process.stdin.isTTY)
                            process.stdin.setRawMode(wasRaw);
                          process.stdin.pause();
                          resolve();
                        });
                      }),
                  );
                }

                if (exitCode !== 0) {
                  yield* Effect.fail(
                    new LauncherError(`Command failed: ${cmd}`, exitCode),
                  );
                }
              } finally {
                renderer.currentRenderBuffer.clear();
                renderer.resume();
                renderer.requestRender();
                log("Resumed after command");
              }
            }),

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
              return yield* executor
                .run("bash", ["-c", cmd])
                .pipe(
                  Effect.catchTag("CommandError", (err: CommandError) =>
                    Effect.fail(
                      new LauncherError(
                        `Command failed: ${cmd}\n${err.stderr}`,
                        err.exitCode,
                      ),
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
              yield* Effect.fail(
                new LauncherError(`Command failed: ${cmd}`, exitCode),
              );
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
            return yield* executor
              .run("bash", ["-c", cmd])
              .pipe(
                Effect.catchTag("CommandError", (err: CommandError) =>
                  Effect.fail(
                    new LauncherError(
                      `Command failed: ${cmd}\n${err.stderr}`,
                      err.exitCode,
                    ),
                  ),
                ),
              );
          }),
      };
    }),
  );
}
