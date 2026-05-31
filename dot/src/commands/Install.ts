import { Effect } from "effect";
import { join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher, LauncherError } from "../services/Launcher.js";
import { listStowFolders } from "../lib/stowFolders.js";
import { ensureHyprHostLink } from "../lib/omarchyHost.js";
import { ensureStowInstalled } from "../lib/packageSetup.js";
import {
  backupFileIfUnmanaged,
  backupPrivateStowTargets,
  findExternalSkillSymlinks,
  removeExternalSymlinks,
  restoreExternalSymlinks,
  type ExternalSymlink,
} from "../lib/stowConflicts.js";

const HOME = process.env.HOME ?? "/home/" + process.env.USER;

/** Extra stow flags for the agents folder (matches legacy behaviour) */
const AGENTS_PRIVATE_IGNORES = [
  "--ignore=node_modules",
  "--ignore='package\\.json'",
  "--ignore='bun\\.lock'",
  "--ignore='\\.gitignore'",
];

/**
 * Install dotfiles: backup existing files, then stow with `--adopt`.
 *
 * Ensures stow is installed, backs up known conflict files (`.zshrc`,
 * `.editorconfig`, ghostty config, nvim directory), then stows public and
 * private dotfiles.
 */
export const install = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;
  const launcher = yield* Launcher;

  yield* ensureStowInstalled;

  yield* log.section("Backup");
  yield* Effect.sync(() => backupPublicFiles(config.publicDotfiles));
  yield* log.info("Backed up existing files (if any)");

  yield* log.section("Install Public Dotfiles");
  yield* stowRepo(config.publicDotfiles, "public", "install", launcher, log);

  yield* log.section("Omarchy Host Links");
  yield* ensureHyprHostLink(config, log);

  if (config.canUsePrivate && config.privateDotfiles) {
    const privateDotfiles = config.privateDotfiles;
    yield* log.section("Install Private Dotfiles");
    yield* Effect.sync(() => backupPrivateStowTargets(privateDotfiles));
    yield* stowRepo(privateDotfiles, "private", "install", launcher, log);
  } else {
    yield* log.warn(
      "Skipping private install (private dotfiles not available)",
    );
  }

  yield* log.section("Complete");
  yield* log.info("Dotfiles installed successfully");
});

/**
 * Backup known files that may conflict with public stow packages.
 * Skips symlinks (already managed). Moves real files into `$repo/backup/`.
 */
function backupPublicFiles(publicDotfiles: string): void {
  const backupRoot = join(publicDotfiles, "backup");

  const targets = [
    { source: join(HOME, ".zshrc"), backupDir: backupRoot },
    { source: join(HOME, ".editorconfig"), backupDir: backupRoot },
    {
      source: join(HOME, ".config/ghostty/config.toml"),
      backupDir: join(backupRoot, ".config/ghostty"),
    },
    {
      source: join(HOME, ".config/nvim"),
      backupDir: join(backupRoot, ".config"),
    },
  ];

  for (const { source, backupDir } of targets) {
    backupFileIfUnmanaged(source, backupDir);
  }
}

/** Stow all folders in a repo using install mode (--adopt for public, normal for private) */
const stowRepo = (
  repoDir: string,
  scope: "public" | "private",
  mode: "install",
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
    const displayPath = repoDir.replace(HOME, "~");

    for (const folder of folders) {
      yield* log.info(`[${scope}] stow ${folder} (repo: ${displayPath})`);

      // Unstow first (clean slate)
      const unstowExit = yield* launcher.stream(`stow -D ${folder}`, {
        cwd: repoDir,
      });
      if (unstowExit !== 0) {
        yield* log.error(
          `[${scope}] unstow ${folder} failed (exit ${unstowExit})`,
        );
        return yield* Effect.fail(
          new LauncherError(
            `${scope} install unstow failed on ${folder}`,
            unstowExit,
          ),
        );
      }

      // Build stow command with folder-specific flags
      const flags: string[] = [];
      let externalLinks: ExternalSymlink[] = [];
      if (folder === "agents") {
        flags.push("--no-folding");
        if (scope === "private") {
          flags.push(...AGENTS_PRIVATE_IGNORES);
        }
        externalLinks = findExternalSkillSymlinks(repoDir);
        if (externalLinks.length > 0) {
          removeExternalSymlinks(externalLinks);
        }
      }

      // Install mode uses --adopt for public scope
      if (scope === "public") {
        flags.push("--adopt");
      }

      const stowCmd = ["stow", ...flags, folder].join(" ");
      const exit = yield* launcher.stream(stowCmd, { cwd: repoDir });

      if (externalLinks.length > 0) {
        restoreExternalSymlinks(externalLinks);
      }

      if (exit !== 0) {
        yield* log.error(`[${scope}] stow ${folder} failed (exit ${exit})`);
        return yield* Effect.fail(
          new LauncherError(`${scope} install stow failed on ${folder}`, exit),
        );
      }
    }
  });
