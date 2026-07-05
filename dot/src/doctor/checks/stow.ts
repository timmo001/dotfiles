import { Effect } from "effect";
import { existsSync } from "fs";
import { listStowFolders, requiresNoFolding } from "../../lib/stowFolders.js";
import { displayPath } from "../../lib/paths.js";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

/** Check stow integrity by running dry-run restow on all packages */
export const checkStow = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  // Need stow installed
  const stowExit = yield* executor.exitCode("which", ["stow"]);
  if (stowExit !== 0) {
    results.push({
      severity: "warn",
      message: "stow not installed \u2014 cannot verify link integrity",
    });
    return results;
  }

  let driftFound = false;

  const checkRepo = (repoDir: string, scope: string) =>
    Effect.gen(function* () {
      const folders = listStowFolders(repoDir, config).sort();

      for (const folder of folders) {
        const extraArgs: string[] = [];
        if (requiresNoFolding(repoDir, folder)) {
          extraArgs.push("--no-folding");
        }
        if (folder === "agents" && scope === "private") {
          extraArgs.push(
            "--ignore=node_modules",
            "--ignore=package\\.json",
            "--ignore=bun\\.lock",
            "--ignore=\\.gitignore",
          );
        }

        const cmd = ["stow", "-n", "-v", ...extraArgs, folder].join(" ");
        const output = yield* executor
          .run("bash", ["-c", `cd ${JSON.stringify(repoDir)} && ${cmd} 2>&1`])
          .pipe(Effect.catch(() => Effect.succeed("")));

        // Filter out no-op revert lines, check for actual drift
        const hasDrift = output
          .split("\n")
          .filter((line: string) => !line.includes("reverts previous action"))
          .some(
            (line: string) =>
              line.startsWith("LINK:") ||
              line.startsWith("ERROR") ||
              line.includes("existing target"),
          );

        if (hasDrift) {
          driftFound = true;
          results.push({
            severity: "warn",
            message: `Stow package '${folder}' in ${displayPath(repoDir)} needs restow`,
            detail: "Run on this machine: dot stow",
          });
        }
      }
    });

  if (existsSync(config.publicDotfiles)) {
    yield* checkRepo(config.publicDotfiles, "public");
  }

  if (config.canUsePrivate && config.privateDotfiles) {
    yield* checkRepo(config.privateDotfiles, "private");
  }

  if (!driftFound) {
    results.push({
      severity: "ok",
      message: "All stow packages are correctly linked",
    });
  }

  return results;
});
