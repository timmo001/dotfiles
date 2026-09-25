import { join } from "node:path";
import {
  Clock,
  Effect,
  FileSystem,
  PlatformError,
  Result,
  Stream,
} from "effect";
import { CommandError, CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { DependencyRunError } from "./state.js";

function redact(text: string) {
  return text
    .replace(/https:\/\/[^\s/@]+:[^\s/@]+@/g, "https://[redacted]@")
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g,
      "[redacted]",
    )
    .replace(
      /((?:authorization|token|password|secret)\s*[:=]\s*)[^\s,]+/gi,
      "$1[redacted]",
    );
}

/** Parent log that also receives a child run's events. */
export interface DependencyRunLogParent {
  /** Parent run log receiving forwarded lines. */
  readonly log: {
    /** Append an already redacted line to the parent log. */
    readonly record: (
      text: string,
    ) => Effect.Effect<void, PlatformError.PlatformError>;
  };
  /** Optional label prefixed to forwarded lines. */
  readonly label?: string;
}

/** Capture bounded command output and timings in the retained run directory. */
export const dependencyRunLog = Effect.fn("Dependencies.runLog")(function* (
  directory: string,
  parent?: DependencyRunLogParent,
) {
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;
  const output = yield* OutputLog;
  yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "run.log");

  const record = Effect.fn("Dependencies.record")(function* (text: string) {
    yield* fs.writeFileString(path, `${text}\n`, { flag: "a", mode: 0o600 });

    if (parent)
      yield* parent.log.record(
        parent.label ? `[${parent.label}] ${text}` : text,
      );
  });

  const event = Effect.fn("Dependencies.event")(function* (message: string) {
    yield* record(redact(message));
    yield* output.info(redact(message));
  });

  const command = Effect.fn("Dependencies.command")(function* (
    label: string,
    argv: readonly string[],
    cwd: string,
    timeout: number,
    capture = false,
  ) {
    const started = yield* Clock.currentTimeMillis;
    yield* event(`[${label}] ${JSON.stringify(argv)} (${cwd})`);
    const args = ["run", "--timeout", `${timeout} millis`, "--", ...argv];

    const execution = capture
      ? executor.run("dot", args, { cwd })
      : executor.stream("dot", args, { cwd }).pipe(
          Stream.runForEach((line) =>
            fs.writeFileString(path, `${redact(line)}\n`, {
              flag: "a",
              mode: 0o600,
            }),
          ),
          Effect.as(""),
        );

    const result = yield* execution.pipe(Effect.result);
    const duration = (yield* Clock.currentTimeMillis) - started;
    yield* event(
      `[${label}] ${Result.isSuccess(result) ? "Passed" : "Failed"} in ${duration}ms`,
    );

    if (Result.isFailure(result)) {
      const failure =
        result.failure instanceof CommandError
          ? result.failure.stderr
          : result.failure instanceof Error
            ? result.failure.message
            : String(result.failure);

      yield* record(redact(failure));

      return yield* new DependencyRunError({
        message: /without [`'"]?workflow[`'"]? scope/i.test(failure)
          ? `GitHub credential lacks workflow scope; run gh auth refresh --hostname github.com --scopes workflow, then retry; see ${path}`
          : `${label} failed; see ${path}`,
      });
    }

    if (capture)
      yield* fs.writeFileString(path, redact(result.success), {
        flag: "a",
        mode: 0o600,
      });

    return result.success;
  });

  return { path, record, event, command };
});

/** Run-owned command and event logger. */
export type DependencyRunLog = Effect.Success<
  ReturnType<typeof dependencyRunLog>
>;
