import { Effect } from "effect";
import { existsSync } from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher, LauncherError } from "../services/Launcher.js";
import { INTERNAL_STOW_FOLDERS, listStowFolders } from "../lib/stowFolders.js";
import { displayPath, homeDir } from "../lib/paths.js";
import { ensureHyprHostLink } from "../lib/omarchyHost.js";
import {
  backupPrivateStowTargets,
  findExternalSkillSymlinks,
  removeExternalSymlinks,
  restoreExternalSymlinks,
  type ExternalSymlink,
} from "../lib/stowConflicts.js";

/** Extra stow flags for the agents folder (matches legacy behaviour) */
const AGENTS_PRIVATE_IGNORES = [
  "--ignore=node_modules",
  "--ignore='package\\.json'",
  "--ignore='bun\\.lock'",
  "--ignore='\\.gitignore'",
];

const HOME = homeDir();

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

      yield* log.section("Omarchy Host Links");
      yield* ensureHyprHostLink(config, log);
    }

    if (runPrivate) {
      if (config.canUsePrivate && config.privateDotfiles) {
        const privateDotfiles = config.privateDotfiles;
        yield* log.section("Stow Private Dotfiles");
        yield* Effect.sync(() => backupPrivateStowTargets(privateDotfiles));
        yield* stowRepo(privateDotfiles, "private", launcher, log);
      } else {
        yield* log.warn(
          "Skipping private stow (private dotfiles not available)",
        );
      }
    }
  });

/** Stow all folders in a single repo */
const stowRepo = (
  repoDir: string,
  scope: "public" | "private",
  launcher: {
    readonly stream: (
      cmd: string,
      opts?: { readonly cwd?: string },
    ) => Effect.Effect<number, LauncherError>;
  },
  log: {
    readonly info: (msg: string) => Effect.Effect<void>;
    readonly error: (msg: string) => Effect.Effect<void>;
  },
) =>
  Effect.gen(function* () {
    const folders = listStowFolders(repoDir).sort();
    const repoDisplayPath = displayPath(repoDir);

    if (scope === "public") {
      yield* unstowLegacyInternalFolders(
        repoDir,
        repoDisplayPath,
        launcher,
        log,
      );
    }

    for (const folder of folders) {
      yield* log.info(`[${scope}] stow ${folder} (repo: ${repoDisplayPath})`);

      // Unstow first, then restow (equivalent to --restow per folder)
      const unstowCmd = `stow -D ${folder}`;
      const unstowExit = yield* launcher.stream(unstowCmd, { cwd: repoDir });
      if (unstowExit !== 0) {
        yield* log.error(
          `[${scope}] unstow ${folder} failed (exit ${unstowExit})`,
        );
        return yield* Effect.fail(
          new LauncherError(`${scope} unstow failed on ${folder}`, unstowExit),
        );
      }

      // Build restow command with folder-specific flags
      const flags: string[] = [];
      let externalLinks: ExternalSymlink[] = [];
      if (folder === "agents") {
        flags.push("--no-folding");
        if (scope === "private") {
          flags.push(...AGENTS_PRIVATE_IGNORES);
        }
        // Temporarily remove external symlinks that would conflict with stow
        externalLinks = findExternalSkillSymlinks(repoDir);
        if (externalLinks.length > 0) {
          removeExternalSymlinks(externalLinks);
        }
      }

      const stowCmd = ["stow", ...flags, folder].join(" ");
      const exit = yield* launcher.stream(stowCmd, { cwd: repoDir });

      // Restore external symlinks regardless of stow success
      if (externalLinks.length > 0) {
        restoreExternalSymlinks(externalLinks);
      }

      if (exit !== 0) {
        yield* log.error(`[${scope}] stow ${folder} failed (exit ${exit})`);
        return yield* Effect.fail(
          new LauncherError(`${scope} stow failed on ${folder}`, exit),
        );
      }
    }
  });

/** Remove links left behind by packages that are no longer stowed. */
const unstowLegacyInternalFolders = (
  repoDir: string,
  displayPath: string,
  launcher: {
    readonly stream: (
      cmd: string,
      opts?: { readonly cwd?: string },
    ) => Effect.Effect<number, LauncherError>;
  },
  log: {
    readonly info: (msg: string) => Effect.Effect<void>;
    readonly error: (msg: string) => Effect.Effect<void>;
  },
) =>
  Effect.gen(function* () {
    for (const folder of INTERNAL_STOW_FOLDERS) {
      if (!existsSync(join(repoDir, folder))) continue;

      yield* log.info(
        `[public] unstow legacy ${folder} (repo: ${displayPath})`,
      );
      const exit = yield* launcher.stream(`stow -D ${folder}`, {
        cwd: repoDir,
      });

      if (exit !== 0) {
        yield* log.error(
          `[public] unstow legacy ${folder} failed (exit ${exit})`,
        );
        return yield* Effect.fail(
          new LauncherError(`public legacy unstow failed on ${folder}`, exit),
        );
      }
    }
  });
