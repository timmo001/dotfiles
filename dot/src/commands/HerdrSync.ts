import { Effect } from "effect";
import { existsSync } from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { displayPath } from "../lib/paths.js";

/**
 * Link the local Herdr plugin package and refresh first-party integrations.
 *
 * The command is intentionally best-effort when Herdr is not installed yet so
 * bootstrap and recovery shells can still complete before mise installs tools.
 */
export const herdrSync = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  yield* log.section("Herdr Sync");

  if ((yield* executor.exitCode("which", ["herdr"])) !== 0) {
    yield* log.warn("Skipped: herdr not found on PATH");
    return;
  }

  const pluginDir = join(
    config.publicDotfiles,
    "herdr",
    ".config",
    "herdr",
    "plugins",
    "dot-actions",
  );

  if (!existsSync(join(pluginDir, "herdr-plugin.toml"))) {
    yield* log.warn(`Skipped (missing plugin): ${displayPath(pluginDir)}`);
    return;
  }

  const linkCode = yield* executor.inherit("herdr", [
    "plugin",
    "link",
    pluginDir,
  ]);
  if (linkCode !== 0) {
    yield* log.warn(`herdr plugin link failed (exit ${linkCode})`);
  } else {
    yield* log.info(`Linked plugin: ${displayPath(pluginDir)}`);
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
