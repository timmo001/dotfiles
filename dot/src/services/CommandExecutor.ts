import {
  Context,
  Effect,
  Layer,
  Option,
  PlatformError,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { constants } from "node:os";
import { writeMirroredLog } from "../lib/logMirror.js";
import { expandHomePath } from "../lib/paths.js";
import { ENV, envString } from "../lib/env.js";
import { formatCause } from "../lib/schema.js";
import { OutputLog } from "./OutputLog.js";

const DEBUG = !!envString(ENV.DOT_DEBUG);

const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:CommandExecutor] ${msg}`);
};

/** Domain error for command execution failures */
export class CommandError extends Schema.TaggedError<CommandError>()(
  "CommandError",
  {
    command: Schema.String,
    exitCode: Schema.Finite,
    stderr: Schema.String,
    /** Captured stdout of a completed `run` that exited non-zero. */
    stdout: Schema.optionalKey(Schema.String),
  },
) {}

const toCommandError = (command: string) => (cause: unknown) =>
  new CommandError({ command, exitCode: 1, stderr: formatCause(cause) });

const signalPattern = /receipt of signal: '(SIG[A-Z0-9]+)'/;

const signalNumber = (error: PlatformError.PlatformError) => {
  const name = signalPattern.exec(String(error.reason.cause))?.[1];

  return Object.entries(constants.signals).find(
    ([signal]) => signal === name,
  )?.[1];
};

/**
 * Wait for a spawned process and return its exit status, reporting a process
 * killed by a signal as `128 + signal` like a POSIX shell.
 */
export const exitStatus = (
  handle: ChildProcessSpawner.ChildProcessHandle,
): Effect.Effect<number, PlatformError.PlatformError> =>
  handle.exitCode.pipe(
    Effect.map(Number),
    Effect.catch((error) => {
      const signal = signalNumber(error);

      return signal === undefined
        ? Effect.fail(error)
        : Effect.succeed(128 + signal);
    }),
  );

/**
 * Leave the process group alone once the command has exited. The spawner
 * otherwise terminates the group on scope close, which would kill background
 * processes a successful command deliberately left running.
 */
const release = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  handle.unref.pipe(Effect.ignore);

function inheritedCommandLogFile(): string | null {
  if (envString(ENV.DOT_TEE_INHERIT_LOG) !== "1") return null;
  const logFile = envString(ENV.DOT_LOG_FILE);

  return logFile ? expandHomePath(logFile) : null;
}

const pipeProcessOutput = (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  output: Pick<typeof process.stdout, "write">,
  logFile: string,
) =>
  Stream.runForEach(stream, (chunk) =>
    Effect.sync(() => {
      output.write(chunk);
      writeMirroredLog(logFile, chunk);
    }),
  );

const lines = (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
) => stream.pipe(Stream.decodeText(), Stream.splitLines);

const describe = (fullCmd: readonly string[], cwd: string | undefined) =>
  `${fullCmd.join(" ")}${cwd ? ` (cwd: ${cwd})` : ""}`;

/** Service interface for executing subprocess commands via Effect */
export interface CommandExecutorService {
  /** Run a command and return its stdout as a string. Fails on non-zero exit. */
  readonly run: (
    cmd: string,
    args: readonly string[],
    opts?: {
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string>>;
      /** Keep the child in dot's process group so signals sent to the group reach it. */
      readonly sameProcessGroup?: boolean;
      /** Capture stdout and stderr interleaved, in arrival order, as stdout. */
      readonly mergeStderr?: boolean;
    },
  ) => Effect.Effect<string, CommandError>;

  /** Run a command and stream its combined stdout lines */
  readonly stream: (
    cmd: string,
    args: readonly string[],
    opts?: { readonly cwd?: string },
  ) => Stream.Stream<string, CommandError>;

  /** Run a command and return its exit code (does not fail on non-zero) */
  readonly exitCode: (
    cmd: string,
    args: readonly string[],
    opts?: {
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string>>;
    },
  ) => Effect.Effect<number>;

  /** Run a command with inherited stdio (stdin/stdout/stderr pass through) */
  readonly inherit: (
    cmd: string,
    args: readonly string[],
    opts?: {
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string>>;
    },
  ) => Effect.Effect<number>;
}

/** Effect service for {@link CommandExecutorService} */
export class CommandExecutor extends Context.Service<
  CommandExecutor,
  CommandExecutorService
>()("CommandExecutor") {
  /** Runs commands through the platform `ChildProcessSpawner`. */
  static readonly layer = Layer.effect(
    CommandExecutor,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const envOptions = (env: Readonly<Record<string, string>> | undefined) =>
        env ? { env: { ...env }, extendEnv: true } : {};

      return {
        run: (cmd, args, opts) => {
          const fullCmd = [cmd, ...args];
          const command = fullCmd.join(" ");
          log(`run: ${describe(fullCmd, opts?.cwd)}`);

          return Effect.gen(function* () {
            const handle = yield* spawner.spawn(
              ChildProcess.make(cmd, args, {
                cwd: opts?.cwd,
                detached: opts?.sameProcessGroup ? false : undefined,
                stdin: "ignore",
                ...envOptions(opts?.env),
              }),
            );

            const [stdout, stderr, exitCode] = yield* Effect.all(
              opts?.mergeStderr
                ? [
                    Stream.mkString(Stream.decodeText(handle.all)),
                    Effect.succeed(""),
                    exitStatus(handle),
                  ]
                : [
                    Stream.mkString(Stream.decodeText(handle.stdout)),
                    Stream.mkString(Stream.decodeText(handle.stderr)),
                    exitStatus(handle),
                  ],
              { concurrency: "unbounded" },
            );

            yield* release(handle);

            if (exitCode !== 0) {
              return yield* new CommandError({
                command,
                exitCode,
                stderr: stderr.trim(),
                stdout,
              });
            }

            return stdout;
          }).pipe(
            Effect.scoped,
            Effect.catchTag("PlatformError", (error) =>
              Effect.fail(toCommandError(command)(error)),
            ),
            Effect.tapError((error) =>
              Effect.sync(() =>
                log(`Failed (exit ${error.exitCode}): ${error.command}`),
              ),
            ),
          );
        },

        stream: (cmd, args, opts) => {
          const fullCmd = [cmd, ...args];
          const command = fullCmd.join(" ");
          log(`stream: ${describe(fullCmd, opts?.cwd)}`);

          return Stream.unwrap(
            Effect.gen(function* () {
              const handle = yield* spawner.spawn(
                ChildProcess.make(cmd, args, {
                  cwd: opts?.cwd,
                  stdin: "ignore",
                }),
              );

              const stderrLines: string[] = [];

              const output = Stream.merge(
                lines(handle.stdout),
                lines(handle.stderr).pipe(
                  Stream.tap((line) =>
                    Effect.sync(() => stderrLines.push(line)),
                  ),
                ),
              );

              const exit = Stream.fromEffect(
                Effect.gen(function* () {
                  const exitCode = yield* exitStatus(handle);
                  yield* release(handle);

                  if (exitCode !== 0) {
                    return yield* new CommandError({
                      command,
                      exitCode,
                      stderr: stderrLines.join("\n").trim(),
                    });
                  }
                }),
              ).pipe(Stream.drain);

              return Stream.concat(output, exit);
            }),
          ).pipe(
            Stream.catchTag("PlatformError", (error) =>
              Stream.fail(toCommandError(command)(error)),
            ),
          );
        },

        exitCode: (cmd, args, opts) => {
          log(`exitCode: ${describe([cmd, ...args], opts?.cwd)}`);

          return Effect.gen(function* () {
            const handle = yield* spawner.spawn(
              ChildProcess.make(cmd, args, {
                cwd: opts?.cwd,
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
                ...envOptions(opts?.env),
              }),
            );

            const exitCode = yield* exitStatus(handle);
            yield* release(handle);

            return exitCode;
          }).pipe(Effect.scoped, Effect.orDie);
        },

        inherit: (cmd, args, opts) => {
          const fullCmd = [cmd, ...args];
          log(`inherit: ${describe(fullCmd, opts?.cwd)}`);
          const commandLogFile = inheritedCommandLogFile();

          const run = Effect.gen(function* () {
            if (commandLogFile)
              writeMirroredLog(commandLogFile, `\n$ ${fullCmd.join(" ")}\n`);

            // Stay in dot's process group so the child keeps the terminal
            // foreground for prompts and receives Ctrl-C directly.
            const handle = yield* spawner.spawn(
              ChildProcess.make(cmd, args, {
                cwd: opts?.cwd,
                detached: false,
                stdin: "inherit",
                stdout: commandLogFile ? "pipe" : "inherit",
                stderr: commandLogFile ? "pipe" : "inherit",
                ...envOptions(opts?.env),
              }),
            );

            if (!commandLogFile) return yield* exitStatus(handle);

            const [, , exitCode] = yield* Effect.all(
              [
                pipeProcessOutput(
                  handle.stdout,
                  process.stdout,
                  commandLogFile,
                ),
                pipeProcessOutput(
                  handle.stderr,
                  process.stderr,
                  commandLogFile,
                ),
                exitStatus(handle),
              ],
              { concurrency: "unbounded" },
            );

            return exitCode;
          }).pipe(Effect.scoped, Effect.orDie);

          // The child owns the terminal, so keep any spinner off its lines.
          return Effect.serviceOption(OutputLog).pipe(
            Effect.flatMap((log) =>
              Option.isSome(log) ? log.value.withSpinnerPaused(run) : run,
            ),
          );
        },
      };
    }),
  );
}
