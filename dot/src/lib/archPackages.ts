import { Effect } from "effect";
import { readListFile } from "./listFile.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** Whether a package is installed. */
export function isPackageInstalled(
  packageName: string,
): Effect.Effect<boolean, never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    return (yield* executor.exitCode("pacman", ["-Q", packageName])) === 0;
  });
}

/** Load a package list file: one package per line, skipping comments and blanks. */
export function loadPackageList(filePath: string): readonly string[] {
  return readListFile(filePath) ?? [];
}

/** Load and de-duplicate packages from multiple package list files. */
export function loadPackageLists(
  filePaths: readonly string[],
): readonly string[] {
  return [
    ...new Set(filePaths.flatMap((filePath) => loadPackageList(filePath))),
  ];
}
