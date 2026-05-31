import { Context, Effect, Layer, Schema, Stream } from "effect";
import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const DEBUG = !!process.env.DOT_DEBUG;
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:CommandExecutor] ${msg}`);
};

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

type ProcessStreamName = "stdout" | "stderr";

interface ProcessLineResult {
  readonly source: ProcessStreamName;
  readonly result: IteratorResult<string>;
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

function expandHomePath(path: string): string {
  return path.replace(/^~(?=\/|$)/, process.env.HOME ?? "");
}

function inheritedCommandLogFile(): string | null {
  if (process.env.DOT_TEE_INHERIT_LOG !== "1") return null;
  return process.env.DOT_LOG_FILE
    ? expandHomePath(process.env.DOT_LOG_FILE)
    : null;
}

function appendRawLog(
  logFile: string | null,
  chunk: Uint8Array | string,
): void {
  if (!logFile) return;
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, chunk);
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
    opts?: { readonly cwd?: string },
  ) => Effect.Effect<number>;

  /** Run a command with inherited stdio (stdin/stdout/stderr pass through) */
  readonly inherit: (
    cmd: string,
    args: readonly string[],
    opts?: { readonly cwd?: string },
  ) => Effect.Effect<number>;
}

/** Create an async iterable of lines from a subprocess stdout */
async function* lineIterator(
  stdout: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      yield line;
    }
  }

  // Flush remaining buffer
  if (buffer.length > 0) {
    yield buffer;
  }
}

function nextProcessLine(
  source: ProcessStreamName,
  iterator: AsyncIterator<string>,
): Promise<ProcessLineResult> {
  return iterator.next().then((result) => ({ source, result }));
}

async function* processLineIterator(
  fullCmd: string[],
  opts?: { readonly cwd?: string },
): AsyncGenerator<string, void, unknown> {
  const proc = Bun.spawn(fullCmd, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts?.cwd,
  });

  const stdout = lineIterator(proc.stdout as ReadableStream<Uint8Array>)[
    Symbol.asyncIterator
  ]();
  const stderr = lineIterator(proc.stderr as ReadableStream<Uint8Array>)[
    Symbol.asyncIterator
  ]();
  const stderrLines: string[] = [];

  let stdoutNext: Promise<ProcessLineResult> | undefined = nextProcessLine(
    "stdout",
    stdout,
  );
  let stderrNext: Promise<ProcessLineResult> | undefined = nextProcessLine(
    "stderr",
    stderr,
  );

  while (stdoutNext || stderrNext) {
    const pending = [stdoutNext, stderrNext].filter(
      (promise): promise is Promise<ProcessLineResult> => promise !== undefined,
    );
    if (pending.length === 0) break;

    const next = await Promise.race(pending);
    if (next.result.done) {
      if (next.source === "stdout") {
        stdoutNext = undefined;
      } else {
        stderrNext = undefined;
      }
      continue;
    }

    if (next.source === "stderr") {
      stderrLines.push(next.result.value);
    }

    yield next.result.value;

    if (next.source === "stdout") {
      stdoutNext = nextProcessLine("stdout", stdout);
    } else {
      stderrNext = nextProcessLine("stderr", stderr);
    }
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const failure: CommandFailure = {
      command: fullCmd.join(" "),
      exitCode,
      stderr: stderrLines.join("\n").trim(),
    };
    throw failure;
  }
}

/** Effect service for {@link CommandExecutorService} */
export class CommandExecutor extends Context.Service<
  CommandExecutor,
  CommandExecutorService
>()("CommandExecutor") {
  static readonly layer = Layer.succeed(CommandExecutor, {
    run: (cmd, args, opts) =>
      Effect.tryPromise({
        try: async () => {
          const fullCmd = [cmd, ...args];
          log(
            `run: ${fullCmd.join(" ")}${opts?.cwd ? ` (cwd: ${opts.cwd})` : ""}`,
          );
          const proc = Bun.spawn(fullCmd, {
            stdout: "pipe",
            stderr: "pipe",
            cwd: opts?.cwd,
          });

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

      return Stream.unwrap(
        Effect.sync(() => {
          return Stream.fromAsyncIterable(
            processLineIterator(fullCmd, opts),
            (error) => toCommandError(error, fullCmd.join(" ")),
          );
        }),
      );
    },

    exitCode: (cmd, args, opts) =>
      Effect.promise(async () => {
        const fullCmd = [cmd, ...args];
        log(
          `exitCode: ${fullCmd.join(" ")}${opts?.cwd ? ` (cwd: ${opts.cwd})` : ""}`,
        );
        const proc = Bun.spawn(fullCmd, {
          stdout: "ignore",
          stderr: "ignore",
          cwd: opts?.cwd,
        });
        return proc.exited;
      }),

    inherit: (cmd, args, opts) =>
      Effect.promise(async () => {
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
        return proc.exited;
      }),
  });
}
