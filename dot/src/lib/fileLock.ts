import { Duration, Effect, FileSystem, Schedule, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { dirname } from "path";

/** Failure to open or acquire an exclusive kernel file lock. */
export class FileLockError extends Schema.TaggedError<FileLockError>()(
  "FileLockError",
  {
    /** `busy` when another process still holds the lock after waiting. */
    reason: Schema.Literals(["busy", "failed"]),
    message: Schema.String,
  },
) {}

const LOCK_POLL = Duration.millis(250);

/** Line the holder prints once `flock` has taken the lock. */
const LOCKED_MARKER = "locked";

/**
 * Hold an exclusive `flock` on `path` until the surrounding scope closes.
 *
 * The lock is held by a `flock` child that keeps the file open while it waits
 * for its stdin to close, so the kernel releases the lock when the scope
 * closes or if dot crashes. The file stays in place so every caller locks the
 * same inode. Without `wait`, a held lock fails immediately as `busy`.
 */
export const acquireFileLock = Effect.fn("fileLock.acquire")(function* (
  path: string,
  options: { readonly wait?: Duration.Input } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const failed = (error: { readonly message: string }) =>
    new FileLockError({ reason: "failed", message: error.message });

  yield* fs
    .makeDirectory(dirname(path), { recursive: true, mode: 0o700 })
    .pipe(Effect.mapError(failed));

  yield* fs
    .writeFileString(path, "", { flag: "a+", mode: 0o600 })
    .pipe(Effect.mapError(failed));

  const polls = options.wait
    ? Math.floor(
        Duration.toMillis(Duration.fromInputUnsafe(options.wait)) /
          Duration.toMillis(LOCK_POLL),
      )
    : 0;

  const attempt = Effect.gen(function* () {
    const handle = yield* spawner.spawn(
      ChildProcess.make(
        "flock",
        [
          "--exclusive",
          "--nonblock",
          path,
          "sh",
          "-c",
          `echo ${LOCKED_MARKER}; exec cat`,
        ],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      ),
    );

    const firstLine = yield* handle.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.take(1),
      Stream.runCollect,
    );

    if (firstLine[0] === LOCKED_MARKER) return true;

    const exitCode = yield* handle.exitCode;

    if (exitCode === 1) return false;

    const stderr = yield* handle.stderr.pipe(
      Stream.decodeText(),
      Stream.mkString,
    );

    return yield* failed({ message: stderr.trim() || "flock failed" });
  }).pipe(Effect.mapError(failed));

  const acquired = yield* attempt.pipe(
    Effect.repeat({
      while: (locked) => !locked,
      times: polls,
      schedule: Schedule.spaced(LOCK_POLL),
    }),
  );

  if (!acquired)
    return yield* new FileLockError({
      reason: "busy",
      message: `${path} is locked by another process`,
    });
});
