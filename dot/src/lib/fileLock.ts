import { Duration, Effect, Schedule, Schema } from "effect";
import { closeSync, mkdirSync, openSync } from "fs";
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

/**
 * Hold an exclusive `flock` on `path` until the surrounding scope closes.
 *
 * The lock lives on an inherited descriptor, so the kernel releases it even
 * if dot crashes. The file stays in place so every caller locks the same
 * inode. Without `wait`, a held lock fails immediately as `busy`.
 */
export const acquireFileLock = Effect.fn("fileLock.acquire")(function* (
  path: string,
  options: { readonly wait?: Duration.Input } = {},
) {
  const descriptor = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

        return openSync(path, "a+", 0o600);
      },
      catch: (error) =>
        new FileLockError({ reason: "failed", message: String(error) }),
    }),
    (fd) => Effect.sync(() => closeSync(fd)),
  );

  const polls = options.wait
    ? Math.floor(
        Duration.toMillis(Duration.fromInputUnsafe(options.wait)) /
          Duration.toMillis(LOCK_POLL),
      )
    : 0;

  const acquired = yield* Effect.try({
    try: () => {
      const result = Bun.spawnSync(
        ["flock", "--exclusive", "--nonblock", "0"],
        { stdin: descriptor, stdout: "ignore", stderr: "pipe" },
      );

      if (result.exitCode === 0) return true;

      if (result.exitCode === 1) return false;

      throw new Error(result.stderr.toString().trim() || "flock failed");
    },
    catch: (error) =>
      new FileLockError({
        reason: "failed",
        message: error instanceof Error ? error.message : String(error),
      }),
  }).pipe(
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
