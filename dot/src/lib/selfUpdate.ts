import { Effect } from "effect";
import { CommandError, CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { renameSync, chmodSync, realpathSync } from "fs";
import { join, dirname } from "path";
import { ENV, envString } from "./env.js";

const DEBUG = !!envString(ENV.DOT_DEBUG);
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
 * then atomically renames over the current binary. Callers may relaunch when
 * the rebuilt code must continue the current workflow.
 */
export const rebuild = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const outputLog = yield* OutputLog;

  log(`Rebuilding from: ${DOT_SRC}`);

  yield* outputLog.info("Installing dot dependencies");
  yield* executor.run("bun", ["install"], { cwd: DOT_SRC });
  log("Dependencies installed");

  yield* outputLog.info("Compiling dot binary");
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

/** Restart the rebuilt dot binary with inherited stdio and fail on non-zero exit. */
export const restartDot = (
  args: readonly string[],
): Effect.Effect<void, CommandError, CommandExecutor> =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const command = `${BIN_PATH} ${args.join(" ")}`;
    log(`Restarting: ${command}`);
    const exitCode = yield* executor.inherit(BIN_PATH, args);
    if (exitCode !== 0) {
      return yield* Effect.fail(
        new CommandError({ command, exitCode, stderr: "" }),
      );
    }
  });
