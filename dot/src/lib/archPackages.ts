import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { CommandExecutor } from "../services/CommandExecutor.js";

/**
 * Alternate package names to probe for a single logical package. Some packages
 * are listed under an AUR name but register under a shorter alias once built.
 */
export function installedPackageCandidates(
  packageName: string,
): readonly string[] {
  return packageName === "go-automate-git"
    ? ["go-automate-git", "go-automate"]
    : [packageName];
}

/** Whether a package (or any of its alias candidates) is installed. */
export function isPackageInstalled(
  packageName: string,
): Effect.Effect<boolean, never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    for (const candidate of installedPackageCandidates(packageName)) {
      if ((yield* executor.exitCode("pacman", ["-Q", candidate])) === 0) {
        return true;
      }
    }
    return false;
  });
}

/** Load a package list file: one package per line, skipping comments and blanks. */
export function loadPackageList(filePath: string): readonly string[] {
  try {
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

/** Load and de-duplicate packages from multiple package list files. */
export function loadPackageLists(
  filePaths: readonly string[],
): readonly string[] {
  return [
    ...new Set(filePaths.flatMap((filePath) => loadPackageList(filePath))),
  ];
}
