import { Effect } from "effect";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { CONFIG_DIR } from "../../lib/paths.js";
import type { CheckResult } from "../types.js";

/** Check pacman hooks are installed and up to date */
export const checkPacmanHooks = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  const hooksSource = join(CONFIG_DIR, "pacman-hooks");
  if (!existsSync(hooksSource)) {
    // No hooks configured, nothing to check
    return results;
  }

  const hookFiles = hookFileNames(hooksSource);
  if (hookFiles === null) {
    return results;
  }

  for (const hookName of hookFiles) {
    const sourceFile = join(hooksSource, hookName);
    const installedFile = join("/etc/pacman.d/hooks", hookName);

    if (!existsSync(installedFile)) {
      results.push({
        severity: "warn",
        message: `Pacman hook not installed: ${hookName}`,
        detail: `Run: pkexec install -Dm644 ${sourceFile} ${installedFile}`,
      });
      continue;
    }

    const sourceContent = readTextFile(sourceFile);
    const installedContent = readTextFile(installedFile);
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

function hookFileNames(path: string): string[] | null {
  try {
    return readdirSync(path).filter((fileName) => fileName.endsWith(".hook"));
  } catch {
    return null;
  }
}

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}
