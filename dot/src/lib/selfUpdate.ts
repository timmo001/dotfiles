import { Effect } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { renameSync, chmodSync } from "fs";
import { join, dirname } from "path";

const log = (msg: string) => console.error(`[dot:selfUpdate] ${msg}`);

/** Resolve the dot source directory from the running binary's location */
const DOT_SRC = join(dirname(dirname(process.execPath)), "..", "dot");

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

  // Build to temp path
  const tmpPath = `${process.execPath}.new`;
  yield* executor.run(
    "bun",
    ["build", "src/index.ts", "--compile", "--outfile", tmpPath],
    { cwd: DOT_SRC },
  );
  log(`Built to: ${tmpPath}`);

  // Atomic rename
  yield* Effect.sync(() => {
    renameSync(tmpPath, process.execPath);
    chmodSync(process.execPath, 0o755);
  });
  log("Binary replaced");
});
