import { Effect } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";

/**
 * Refresh first-party Herdr integrations.
 *
 * The command is intentionally best-effort when Herdr is not installed yet so
 * bootstrap and recovery shells can still complete before mise installs tools.
 */
export const herdrSync = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  yield* log.section("Herdr Sync");

  if ((yield* executor.exitCode("which", ["herdr"])) !== 0) {
    yield* log.warn("Skipped: herdr not found on PATH");
    return;
  }

  for (const integration of ["opencode"] as const) {
    const exitCode = yield* executor.inherit("herdr", [
      "integration",
      "install",
      integration,
    ]);
    if (exitCode === 0) {
      yield* log.info(`Installed integration: ${integration}`);
    } else {
      yield* log.warn(
        `Herdr integration failed for ${integration} (exit ${exitCode})`,
      );
    }
  }
});
