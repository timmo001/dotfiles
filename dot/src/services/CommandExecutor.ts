import { Context, Effect, Layer, Schema, Stream } from "effect";

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
          if (
            error &&
            typeof error === "object" &&
            "exitCode" in error &&
            "stderr" in error &&
            "command" in error
          ) {
            const e = error as {
              exitCode: number;
              stderr: string;
              command: string;
            };
            log(`Failed (exit ${e.exitCode}): ${e.command}`);
            return new CommandError({
              command: e.command,
              exitCode: e.exitCode,
              stderr: e.stderr,
            });
          }
          const msg = error instanceof Error ? error.message : String(error);
          return new CommandError({
            command: `${cmd} ${args.join(" ")}`,
            exitCode: 1,
            stderr: msg,
          });
        },
      }),

    stream: (cmd, args, opts) => {
      const fullCmd = [cmd, ...args];
      log(
        `stream: ${fullCmd.join(" ")}${opts?.cwd ? ` (cwd: ${opts.cwd})` : ""}`,
      );

      const proc = Bun.spawn(fullCmd, {
        stdout: "pipe",
        stderr: "pipe",
        cwd: opts?.cwd,
      });

      return Stream.fromAsyncIterable(
        lineIterator(proc.stdout as ReadableStream<Uint8Array>),
        (error) =>
          new CommandError({
            command: fullCmd.join(" "),
            exitCode: 1,
            stderr: error instanceof Error ? error.message : String(error),
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
