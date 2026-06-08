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

  let hookFiles: string[];
  try {
    hookFiles = readdirSync(hooksSource).filter((f) => f.endsWith(".hook"));
  } catch {
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

    // Compare contents
    try {
      const sourceContent = readFileSync(sourceFile, "utf-8");
      const installedContent = readFileSync(installedFile, "utf-8");

      if (sourceContent !== installedContent) {
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
    } catch {
      results.push({
        severity: "warn",
        message: `Could not compare pacman hook: ${hookName}`,
      });
    }
  }

  return results;
});
