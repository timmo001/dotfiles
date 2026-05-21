import { Effect } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { renameSync, chmodSync, realpathSync } from "fs";
import { join, dirname } from "path";

const DEBUG = !!process.env.DOT_DEBUG;
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:selfUpdate] ${msg}`);
};

/**
 * Resolve the dot source directory from the running binary's location.
 *
 * Binary lives at `<dotfiles>/scripts/.local/bin/dot`; source is at
 * `<dotfiles>/dot`. Resolve any symlinks (e.g. ~/.local/bin/dot → repo path)
 * before walking up.
 */
const BIN_PATH = (() => {
  try {
    return realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
})();
const DOT_SRC = join(dirname(BIN_PATH), "..", "..", "..", "dot");

/**
 * Rebuild the dot binary from source.
 *
 * Runs `bun install` then `bun build --compile` to a temporary path,
 * then atomically renames over the current binary. The process should
 * exit 0 after this completes — no relaunch needed.
 */
export const rebuild = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  log(`Rebuilding from: ${DOT_SRC}`);

  // Install deps
  yield* executor.run("bun", ["install"], { cwd: DOT_SRC });
  log("Dependencies installed");

  // Build to temp path (use resolved BIN_PATH to avoid overwriting stow symlinks)
  const tmpPath = `${BIN_PATH}.new`;
  yield* executor.run(
    "bun",
    ["build", "src/index.ts", "--compile", "--outfile", tmpPath],
    { cwd: DOT_SRC },
  );
  log(`Built to: ${tmpPath}`);

  // Atomic rename over the real binary (not the symlink)
  yield* Effect.sync(() => {
    renameSync(tmpPath, BIN_PATH);
    chmodSync(BIN_PATH, 0o755);
  });
  log("Binary replaced");
});
