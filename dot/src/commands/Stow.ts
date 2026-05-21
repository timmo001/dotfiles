import { Effect } from "effect";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher, LauncherError } from "../services/Launcher.js";

/** Extra stow flags for the agents folder (matches legacy behaviour) */
const AGENTS_PRIVATE_IGNORES = [
  "--ignore=node_modules",
  "--ignore='package\\.json'",
  "--ignore='bun\\.lock'",
  "--ignore='\\.gitignore'",
];

/**
 * List top-level stow package directories in a repo.
 *
 * Filters out non-directory entries and host-specific packages that
 * don't match `OMARCHY_HOST`.
 */
function listStowFolders(repoDir: string): string[] {
  const host = process.env.OMARCHY_HOST ?? "";
  const entries = readdirSync(repoDir);

  return entries.filter((entry) => {
    const fullPath = join(repoDir, entry);
    try {
      if (!statSync(fullPath).isDirectory()) return false;
    } catch {
      return false;
    }

    // Skip backup folder (only used during install)
    if (entry === "backup") return false;

    // Skip dot-internal directories that aren't stow packages
    if (entry.startsWith(".")) return false;

    // Host-specific packages use double-dash: <name>--<host>
    if (entry.includes("--")) {
      const hostSuffix = entry.split("--").pop()!;
      if (hostSuffix !== host) return false;
    }

    return true;
  });
}

/**
 * Run GNU Stow per-folder for the public and (optionally) private dotfiles repos.
 *
 * Matches legacy behaviour: enumerates stow package directories, logs each one,
 * and applies per-folder stow with appropriate flags.
 */
export const stow = (opts?: {
  readonly publicOnly?: boolean;
  readonly privateOnly?: boolean;
}) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const launcher = yield* Launcher;

    const runPublic = !opts?.privateOnly;
    const runPrivate = !opts?.publicOnly;

    if (runPublic) {
      yield* log.section("Stow Public Dotfiles");
      yield* stowRepo(config.publicDotfiles, "public", launcher, log);
    }

    if (runPrivate) {
      if (config.canUsePrivate && config.privateDotfiles) {
        yield* log.section("Stow Private Dotfiles");
        yield* stowRepo(config.privateDotfiles, "private", launcher, log);
      } else if (!opts?.publicOnly) {
        yield* log.warn("Skipping private stow (private dotfiles not available)");
      }
    }

    yield* log.section("Complete");
    yield* log.info("All packages stowed successfully");
  });

/** Stow all folders in a single repo */
const stowRepo = (
  repoDir: string,
  scope: "public" | "private",
  launcher: { readonly stream: (cmd: string, opts?: { readonly cwd?: string }) => Effect.Effect<number, LauncherError> },
  log: { readonly info: (msg: string) => Effect.Effect<void>; readonly error: (msg: string) => Effect.Effect<void> },
) =>
  Effect.gen(function* () {
    const folders = listStowFolders(repoDir).sort();
    const displayPath = repoDir.replace(process.env.HOME ?? "", "~");

    for (const folder of folders) {
      yield* log.info(`[${scope}] stow ${folder} (repo: ${displayPath})`);

      // Unstow first, then restow (equivalent to --restow per folder)
      const unstowCmd = `stow -D ${folder}`;
      yield* launcher.stream(unstowCmd, { cwd: repoDir });

      // Build restow command with folder-specific flags
      const flags: string[] = [];
      if (folder === "agents") {
        flags.push("--no-folding");
        if (scope === "private") {
          flags.push(...AGENTS_PRIVATE_IGNORES);
        }
      }

      const stowCmd = ["stow", ...flags, folder].join(" ");
      const exit = yield* launcher.stream(stowCmd, { cwd: repoDir });

      if (exit !== 0) {
        yield* log.error(`[${scope}] stow ${folder} failed (exit ${exit})`);
        return yield* Effect.fail(
          new LauncherError(`${scope} stow failed on ${folder}`, exit),
        );
      }
    }
  });
