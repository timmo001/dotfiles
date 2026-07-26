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

/** Installed and missing package sets, preserving the input order. */
export interface PackagePartition {
  readonly present: readonly string[];
  readonly missing: readonly string[];
}

/** Split a package list into installed (present) and missing sets. */
export function partitionInstalled(
  packages: readonly string[],
): Effect.Effect<PackagePartition, never, CommandExecutor> {
  return Effect.gen(function* () {
    const present: string[] = [];
    const missing: string[] = [];
    for (const packageName of packages) {
      if (yield* isPackageInstalled(packageName)) present.push(packageName);
      else missing.push(packageName);
    }
    return { present, missing };
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
