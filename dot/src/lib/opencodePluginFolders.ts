import { Effect, FileSystem } from "effect";
import { dirname, join, relative, resolve } from "path";
import { lstatOrNull, readDirectoryOrNull, readLinkOrNull } from "./fsProbe.js";
import { HOME_DIR } from "./paths.js";

const PLUGINS_DIR = ".config/opencode/plugins";

const ENTRYPOINTS = ["index.ts", "index.js", "server.ts", "server.js"];

/** Whether every entry in a live directory is a link to the same-named source entry. */
const onlyLinksTo = Effect.fn("opencodePluginFolders.onlyLinksTo")(function* (
  target: string,
  source: string,
) {
  const targetEntries = yield* readDirectoryOrNull(target);
  const sourceEntries = yield* readDirectoryOrNull(source);

  if (!targetEntries || !sourceEntries) return false;

  if (targetEntries.length !== sourceEntries.length) return false;

  for (const entry of targetEntries) {
    const link = yield* readLinkOrNull(join(target, entry));

    if (link === null || resolve(target, link) !== join(source, entry)) {
      return false;
    }
  }

  return true;
});

/**
 * Replace stowed OpenCode plugin folders with one symlink each.
 *
 * The `agents` package is stowed with `--no-folding`, which leaves each plugin
 * folder as a real directory of file links. OpenCode skips a folder plugin
 * whose entrypoint resolves outside the folder, so a folder is folded when it
 * holds only links to its own source files. Plain `stow` leaves the folded
 * link alone and `stow -D` removes it.
 *
 * @param repoDir - Absolute path to the stow repo root.
 */
export const foldOpencodePluginFolders = Effect.fn(
  "opencodePluginFolders.fold",
)(function* (repoDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const sourceRoot = join(repoDir, "agents", PLUGINS_DIR);
  const targetRoot = join(HOME_DIR, PLUGINS_DIR);

  for (const entry of (yield* readDirectoryOrNull(sourceRoot)) ?? []) {
    const source = join(sourceRoot, entry);
    const target = join(targetRoot, entry);

    if (entry === "node_modules") continue;

    if ((yield* lstatOrNull(source))?.type !== "Directory") continue;

    const sourceEntries = (yield* readDirectoryOrNull(source)) ?? [];

    if (!sourceEntries.some((name) => ENTRYPOINTS.includes(name))) continue;

    if ((yield* lstatOrNull(target))?.type !== "Directory") continue;

    if (!(yield* onlyLinksTo(target, source))) continue;

    // Removing the links leaves the source files untouched.
    for (const link of (yield* readDirectoryOrNull(target)) ?? []) {
      yield* fs.remove(join(target, link));
    }

    // The directory is empty now; Bun's rm needs `recursive` for directories.
    yield* fs.remove(target, { recursive: true });
    // Stow only recognises its own link form: up to the target root, then down.
    yield* fs.symlink(
      join(relative(dirname(target), HOME_DIR), relative(HOME_DIR, source)),
      target,
    );
  }
});
