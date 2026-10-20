import { Effect } from "effect";
import { readListFile } from "./listFile.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** Whether an apt package is installed. */
export function isPackageInstalled(
  packageName: string,
): Effect.Effect<boolean, never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    const status = yield* executor
      .run("dpkg-query", ["-W", "-f=${Status}", packageName])
      .pipe(Effect.orElseSucceed(() => ""));

    return status.trim() === "install ok installed";
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
