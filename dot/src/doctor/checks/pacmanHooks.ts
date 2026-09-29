import { Effect } from "effect";
import { join } from "path";
import { CONFIG_DIR } from "../../lib/paths.js";
import {
  pathExists,
  readDirectoryOrNull,
  readTextOrNull,
} from "../../lib/fsProbe.js";
import type { CheckResult } from "../types.js";

/** Check pacman hooks are installed and up to date */
export const checkPacmanHooks = Effect.gen(function* () {
  const results: CheckResult[] = [];

  const hooksSource = join(CONFIG_DIR, "pacman-hooks");

  if (!(yield* pathExists(hooksSource))) {
    // No hooks configured, nothing to check
    return results;
  }

  const entries = yield* readDirectoryOrNull(hooksSource);

  const hookFiles =
    entries === null
      ? null
      : entries.filter((fileName) => fileName.endsWith(".hook"));

  if (hookFiles === null) {
    return results;
  }

  for (const hookName of hookFiles) {
    const sourceFile = join(hooksSource, hookName);
    const installedFile = join("/etc/pacman.d/hooks", hookName);

    if (!(yield* pathExists(installedFile))) {
      results.push({
        severity: "warn",
        message: `Pacman hook not installed: ${hookName}`,
        detail: `Run: pkexec install -Dm644 ${sourceFile} ${installedFile}`,
      });
      continue;
    }

    const sourceContent = yield* readTextOrNull(sourceFile);
    const installedContent = yield* readTextOrNull(installedFile);

    if (sourceContent === null || installedContent === null) {
      results.push({
        severity: "warn",
        message: `Could not compare pacman hook: ${hookName}`,
      });
    } else if (sourceContent !== installedContent) {
      results.push({
        severity: "warn",
        message: `Pacman hook out of date: ${hookName}`,
        detail: `Run: pkexec install -Dm644 ${sourceFile} ${installedFile}`,
      });
    } else {
      results.push({
        severity: "ok",
        message: `Pacman hook installed: ${hookName}`,
      });
    }
  }

  return results;
});
