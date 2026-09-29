import { Effect } from "effect";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { CACHE_DIR } from "./paths.js";

const STAMP_DIR = join(CACHE_DIR, "dot", "build-stamps");

const stampFile = (target: string) =>
  join(STAMP_DIR, createHash("sha1").update(target).digest("hex"));

const targetModified = (target: string) => {
  try {
    return String(statSync(target).mtimeMs);
  } catch {
    return null;
  }
};

/**
 * Identify a clean source directory by its committed tree and the Bun version.
 * Returns null when the source is dirty or not in Git, so it always rebuilds.
 */
export const sourceBuildKey = Effect.fn("BuildStamp.sourceBuildKey")(function* (
  sourceDir: string,
) {
  const executor = yield* CommandExecutor;
  const orEmpty = Effect.catch(() => Effect.succeed(""));

  const [tree, status, bunVersion] = yield* Effect.all(
    [
      executor
        .run("git", ["rev-parse", "HEAD:./"], { cwd: sourceDir })
        .pipe(orEmpty),
      executor
        .run("git", ["status", "--porcelain", "--", "."], { cwd: sourceDir })
        .pipe(Effect.catch(() => Effect.succeed("unknown"))),
      executor.run("bun", ["--version"]).pipe(orEmpty),
    ],
    { concurrency: "unbounded" },
  );

  if (!tree.trim() || status.trim() || !bunVersion.trim()) return null;

  return `${tree.trim()} bun-${bunVersion.trim()}`;
});

/** Whether the target was last built from this key and has not changed since. */
export function isBuildCurrent(target: string, key: string | null): boolean {
  if (!key) return false;

  const modified = targetModified(target);

  if (!modified) return false;

  try {
    return readFileSync(stampFile(target), "utf-8") === `${key}\n${modified}`;
  } catch {
    return false;
  }
}

/** Record the key a freshly built target came from. */
export function writeBuildStamp(target: string, key: string | null): void {
  const modified = targetModified(target);

  if (!key || !modified) return;

  mkdirSync(STAMP_DIR, { recursive: true });
  writeFileSync(stampFile(target), `${key}\n${modified}`);
}
