import { Effect } from "effect";
import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;

function displayPath(p: string): string {
  return p.replace(HOME, "~");
}

/** List stow package directories (matches Stow.ts logic) */
function listStowFolders(repoDir: string): string[] {
  const host = process.env.OMARCHY_HOST ?? "";
  try {
    return readdirSync(repoDir).filter((entry) => {
      const fullPath = join(repoDir, entry);
      try {
        if (!statSync(fullPath).isDirectory()) return false;
      } catch {
        return false;
      }
      if (entry === "backup") return false;
      if (entry.startsWith(".")) return false;
      if (entry.includes("--")) {
        const hostSuffix = entry.split("--").pop()!;
        if (hostSuffix !== host) return false;
      }
      return true;
    });
  } catch {
    return [];
  }
}

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
      const folders = listStowFolders(repoDir).sort();

      for (const folder of folders) {
        const extraArgs: string[] = [];
        if (folder === "agents") {
          extraArgs.push("--no-folding");
          if (scope === "private") {
            extraArgs.push(
              "--ignore=node_modules",
              "--ignore=package\\.json",
              "--ignore=bun\\.lock",
              "--ignore=\\.gitignore",
            );
          }
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
