import { Effect, FileSystem } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { displayPath, expandHomePath } from "../../lib/paths.js";
import { SYNCTHING_UNIT, readSyncthingConfig } from "../../lib/syncthing.js";
import type { CheckResult } from "../types.js";

/** Check that Syncthing runs and every configured folder exists. */
export const checkSyncthing = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;

  const config = yield* readSyncthingConfig;

  if (!config)
    return [
      { severity: "ok", message: "Syncthing not configured" },
    ] satisfies CheckResult[];

  const results: CheckResult[] = [];

  if (
    (yield* executor.exitCode("systemctl", [
      "--user",
      "is-active",
      "--quiet",
      SYNCTHING_UNIT,
    ])) === 0
  )
    results.push({ severity: "ok", message: `${SYNCTHING_UNIT} is running` });
  else
    results.push({
      severity: "warn",
      message: `${SYNCTHING_UNIT} is not running`,
      detail: "Run dot stow to enable and apply the Syncthing config",
    });

  for (const [id, folder] of Object.entries(config.folders)) {
    const path = expandHomePath(folder.path);

    results.push(
      (yield* fs.exists(path))
        ? { severity: "ok", message: `Folder ${id} exists` }
        : {
            severity: "warn",
            message: `Folder ${id} is missing: ${displayPath(path)}`,
            detail: "Run dot stow to create it",
          },
    );
  }

  return results;
});
