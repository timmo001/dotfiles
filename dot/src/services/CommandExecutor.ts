import { Cause, Context, Effect, Layer, Queue, Schema, Stream } from "effect";
import { writeMirroredLog } from "../lib/logMirror.js";
import { expandHomePath } from "../lib/paths.js";
import { ENV, envString } from "../lib/env.js";

const DEBUG = !!envString(ENV.DOT_DEBUG);
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:CommandExecutor] ${msg}`);
};

/** Minimal view of a spawned process needed to terminate it. */
type KillableProcess = Pick<Bun.Subprocess, "exitCode" | "kill" | "pid">;

/** Terminate a spawned process if it is still running; a no-op once it has exited. */
function killProcess(proc: KillableProcess): void {
  if (proc.exitCode !== null) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    try {
      proc.kill();
    } catch {
      // Raced with the process exiting between the check and the kill.
    }
  }
}

/**
 * Terminate `proc` when `signal` aborts. Effect aborts this signal on fiber
 * interruption (including timeouts and scope close), so a spawned command that
 * stalls on the network no longer keeps the fiber alive: the process is killed
 * and the interruption proceeds.
 */
function killOnAbort(proc: KillableProcess, signal: AbortSignal): void {
  if (signal.aborted) {
    killProcess(proc);
    return;
  }
  signal.addEventListener("abort", () => killProcess(proc), { once: true });
}

/** Domain error for command execution failures */
export class CommandError extends Schema.TaggedErrorClass<CommandError>()(
  "CommandError",
  {
    command: Schema.String,
    exitCode: Schema.Number,
    stderr: Schema.String,
  },
) {}

interface CommandFailure {
  readonly command: string;
  readonly exitCode: number;
  readonly stderr: string;
}

function isCommandFailure(error: unknown): error is CommandFailure {
  if (!error || typeof error !== "object") return false;

  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.command === "string" &&
    typeof candidate.exitCode === "number" &&
    typeof candidate.stderr === "string"
  );
}

function toCommandError(error: unknown, command: string): CommandError {
  if (isCommandFailure(error)) {
    return new CommandError({
      command: error.command,
      exitCode: error.exitCode,
      stderr: error.stderr,
    });
  }

  return new CommandError({
    command,
    exitCode: 1,
    stderr: error instanceof Error ? error.message : String(error),
  });
}

function inheritedCommandLogFile(): string | null {
  if (envString(ENV.DOT_TEE_INHERIT_LOG) !== "1") return null;
  const logFile = envString(ENV.DOT_LOG_FILE);
  return logFile ? expandHomePath(logFile) : null;
}

function appendRawLog(
  logFile: string | null,
  chunk: Uint8Array | string,
): void {
  if (!logFile) return;
  writeMirroredLog(logFile, chunk);
}

async function pipeProcessOutput(
  stream: ReadableStream<Uint8Array>,
  output: { readonly write: (chunk: Uint8Array) => unknown },
  logFile: string | null,
): Promise<void> {
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    output.write(value);
    appendRawLog(logFile, value);
  }
}

/** Service interface for executing subprocess commands via Effect */
export interface CommandExecutorService {
  /** Run a command and return its stdout as a string. Fails on non-zero exit. */
  readonly run: (
    cmd: string,
    args: readonly string[],
    opts?: { readonly cwd?: string },
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
    opts?: { readonly cwd?: string },
  ) => Effect.Effect<number>;
}

async function pipeLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      onLine(line);
    }
  }

  if (buffer.length > 0) {
    onLine(buffer);
  }
}

function processLineStream(
  fullCmd: readonly string[],
  opts?: { readonly cwd?: string },
): Stream.Stream<string, CommandError> {
  return Stream.unwrap(
    Effect.acquireRelease(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<
          string,
          CommandError | Cause.Done
        >();
        const proc = Bun.spawn([...fullCmd], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: opts?.cwd,
          detached: true,
        });
        const stderrLines: string[] = [];

        const stdout = pipeLines(
          proc.stdout as ReadableStream<Uint8Array>,
          (line) => {
            Queue.offerUnsafe(queue, line);
          },
        );
        const stderr = pipeLines(
          proc.stderr as ReadableStream<Uint8Array>,
          (line) => {
            stderrLines.push(line);
            Queue.offerUnsafe(queue, line);
          },
        );

        void Promise.all([stdout, stderr, proc.exited])
          .then(([, , exitCode]) => {
            if (exitCode === 0) {
              Queue.endUnsafe(queue);
              return;
            }
            Queue.failCauseUnsafe(
              queue,
              Cause.fail(
                new CommandError({
                  command: fullCmd.join(" "),
                  exitCode,
                  stderr: stderrLines.join("\n").trim(),
                }),
              ),
            );
          })
          .catch((error: unknown) => {
            Queue.failCauseUnsafe(
              queue,
              Cause.fail(toCommandError(error, fullCmd.join(" "))),
            );
          });

        return { proc, queue };
      }),
      ({ proc, queue }) =>
        Effect.gen(function* () {
          killProcess(proc);
          yield* Queue.shutdown(queue);
        }),
    ).pipe(Effect.map(({ queue }) => Stream.fromQueue(queue))),
  );
}

/** Effect service for {@link CommandExecutorService} */
export class CommandExecutor extends Context.Service<
  CommandExecutor,
  CommandExecutorService
>()("CommandExecutor") {
  static readonly layer = Layer.succeed(CommandExecutor, {
    run: (cmd, args, opts) =>
      Effect.tryPromise({
        try: async (signal) => {
          const fullCmd = [cmd, ...args];
          log(
            `run: ${fullCmd.join(" ")}${opts?.cwd ? ` (cwd: ${opts.cwd})` : ""}`,
          );
          const proc = Bun.spawn(fullCmd, {
            stdout: "pipe",
            stderr: "pipe",
            cwd: opts?.cwd,
            detached: true,
          });
          killOnAbort(proc, signal);

          const stdout = await new Response(proc.stdout).text();
          const exitCode = await proc.exited;

          if (exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text();
            throw {
              exitCode,
              stderr: stderr.trim(),
              command: fullCmd.join(" "),
            };
          }

          return stdout;
        },
        catch: (error) => {
          const command = `${cmd} ${args.join(" ")}`;
          const commandError = toCommandError(error, command);
          log(
            `Failed (exit ${commandError.exitCode}): ${commandError.command}`,
          );
          return commandError;
        },
      }),

    stream: (cmd, args, opts) => {
      const fullCmd = [cmd, ...args];
      log(
        `stream: ${fullCmd.join(" ")}${opts?.cwd ? ` (cwd: ${opts.cwd})` : ""}`,
      );

      return processLineStream(fullCmd, opts);
    },

    exitCode: (cmd, args, opts) =>
      Effect.promise((signal) => {
        const fullCmd = [cmd, ...args];
        log(
          `exitCode: ${fullCmd.join(" ")}${opts?.cwd ? ` (cwd: ${opts.cwd})` : ""}`,
        );
        const proc = Bun.spawn(fullCmd, {
          stdout: "ignore",
          stderr: "ignore",
          cwd: opts?.cwd,
          detached: true,
          ...(opts?.env ? { env: { ...process.env, ...opts.env } } : {}),
        });
        killOnAbort(proc, signal);
        return proc.exited;
      }),

    inherit: (cmd, args, opts) =>
      Effect.promise(async (signal) => {
        const fullCmd = [cmd, ...args];
        log(
          `inherit: ${fullCmd.join(" ")}${opts?.cwd ? ` (cwd: ${opts.cwd})` : ""}`,
        );
        const commandLogFile = inheritedCommandLogFile();
        if (commandLogFile) {
          appendRawLog(commandLogFile, `\n$ ${fullCmd.join(" ")}\n`);
          const proc = Bun.spawn(fullCmd, {
            stdin: "inherit",
            stdout: "pipe",
            stderr: "pipe",
            cwd: opts?.cwd,
          });
          killOnAbort(proc, signal);
          const stdout = pipeProcessOutput(
            proc.stdout as ReadableStream<Uint8Array>,
            process.stdout,
            commandLogFile,
          );
          const stderr = pipeProcessOutput(
            proc.stderr as ReadableStream<Uint8Array>,
            process.stderr,
            commandLogFile,
          );
          const exitCode = await proc.exited;
          await Promise.all([stdout, stderr]);
          return exitCode;
        }

        const proc = Bun.spawn(fullCmd, {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          cwd: opts?.cwd,
        });
        killOnAbort(proc, signal);
        return proc.exited;
      }),
  });
}
