import { Effect, FileSystem } from "effect";

/** Whether a path exists (following symlinks); any failure counts as absent. */
export const pathExists = Effect.fn("fsProbe.pathExists")(function* (
  path: string,
) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
});

/** Read a UTF-8 file, returning `null` when it cannot be read. */
export const readTextOrNull = Effect.fn("fsProbe.readTextOrNull")(function* (
  path: string,
) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs
    .readFileString(path)
    .pipe(Effect.orElseSucceed((): string | null => null));
});

/** List directory entry names, returning `null` when the directory cannot be read. */
export const readDirectoryOrNull = Effect.fn("fsProbe.readDirectoryOrNull")(
  function* (path: string) {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs
      .readDirectory(path)
      .pipe(Effect.orElseSucceed((): string[] | null => null));
  },
);

/** Read a symlink target, returning `null` when the path is not a readable symlink. */
export const readLinkOrNull = Effect.fn("fsProbe.readLinkOrNull")(function* (
  path: string,
) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs
    .readLink(path)
    .pipe(Effect.orElseSucceed((): string | null => null));
});

/**
 * Whether a path is a symlink (including a broken one), without following it.
 * Returns `null` when the path does not exist at all.
 */
export const isSymbolicLink = Effect.fn("fsProbe.isSymbolicLink")(function* (
  path: string,
) {
  if ((yield* readLinkOrNull(path)) !== null) return true;

  return (yield* pathExists(path)) ? false : null;
});

/** Minimal `lstat` result: entry type and permission mode. */
export interface EntryInfo {
  /** Entry type; symlinks are reported as `SymbolicLink` and never followed. */
  readonly type: FileSystem.File.Type;
  /** Permission bits from `stat` (zero for symlinks). */
  readonly mode: number;
}

/**
 * Describe an entry without following symlinks, like `lstat`.
 * Returns `null` when the path cannot be inspected.
 */
export const lstatOrNull = Effect.fn("fsProbe.lstatOrNull")(function* (
  path: string,
) {
  const fs = yield* FileSystem.FileSystem;

  if ((yield* readLinkOrNull(path)) !== null) {
    const symlink: EntryInfo = { type: "SymbolicLink", mode: 0 };

    return symlink;
  }

  return yield* fs.stat(path).pipe(
    Effect.map((info): EntryInfo | null => ({
      type: info.type,
      mode: info.mode,
    })),
    Effect.orElseSucceed((): EntryInfo | null => null),
  );
});
