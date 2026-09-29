import { Effect, FileSystem, Option } from "effect";
import { createHash } from "crypto";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { CACHE_DIR } from "./paths.js";

const STAMP_DIR = join(CACHE_DIR, "dot", "build-stamps");

const stampFile = (target: string) =>
  join(STAMP_DIR, createHash("sha1").update(target).digest("hex"));

const targetModified = Effect.fn("BuildStamp.targetModified")(function* (
  target: string,
) {
  const fs = yield* FileSystem.FileSystem;

  const info = yield* fs
    .stat(target)
    .pipe(Effect.orElseSucceed((): FileSystem.File.Info | null => null));

  if (info === null) return null;

  return Option.match(info.mtime, {
    onNone: () => null,
    onSome: (mtime) => String(mtime.getTime()),
  });
});

/**
 * Identify a clean source directory by its committed tree and the Bun version.
 * Returns null when the source is dirty or not in Git, so it always rebuilds.
 */
export const sourceBuildKey = Effect.fn("BuildStamp.sourceBuildKey")(function* (
  sourceDir: string,
) {
  const executor = yield* CommandExecutor;
  const orEmpty = Effect.orElseSucceed(() => "");

  const [tree, status, bunVersion] = yield* Effect.all(
    [
      executor
        .run("git", ["rev-parse", "HEAD:./"], { cwd: sourceDir })
        .pipe(orEmpty),
      executor
        .run("git", ["status", "--porcelain", "--", "."], { cwd: sourceDir })
        .pipe(Effect.orElseSucceed(() => "unknown")),
      executor.run("bun", ["--version"]).pipe(orEmpty),
    ],
    { concurrency: "unbounded" },
  );

  if (!tree.trim() || status.trim() || !bunVersion.trim()) return null;

  return `${tree.trim()} bun-${bunVersion.trim()}`;
});

/** Whether the target was last built from this key and has not changed since. */
export const isBuildCurrent = Effect.fn("BuildStamp.isBuildCurrent")(function* (
  target: string,
  key: string | null,
) {
  if (!key) return false;

  const fs = yield* FileSystem.FileSystem;
  const modified = yield* targetModified(target);

  if (!modified) return false;

  return yield* fs.readFileString(stampFile(target)).pipe(
    Effect.map((stamp) => stamp === `${key}\n${modified}`),
    Effect.orElseSucceed(() => false),
  );
});

/** Record the key a freshly built target came from. */
export const writeBuildStamp = Effect.fn("BuildStamp.writeBuildStamp")(
  function* (target: string, key: string | null) {
    const modified = yield* targetModified(target);

    if (!key || !modified) return;

    const fs = yield* FileSystem.FileSystem;

    yield* fs.makeDirectory(STAMP_DIR, { recursive: true });
    yield* fs.writeFileString(stampFile(target), `${key}\n${modified}`);
  },
);

/** Make a freshly compiled binary executable, rename it over `target` and stamp it. */
export const installCompiledBinary = Effect.fn(
  "BuildStamp.installCompiledBinary",
)(function* (temporary: string, target: string, key: string | null) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.chmod(temporary, 0o755);
  yield* fs.rename(temporary, target);
  yield* writeBuildStamp(target, key);
});
