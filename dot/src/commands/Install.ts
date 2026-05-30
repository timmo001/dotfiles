import { Effect } from "effect";
import { existsSync, lstatSync, mkdirSync, renameSync, statSync } from "fs";
import { basename, join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher, LauncherError } from "../services/Launcher.js";
import { listStowFolders } from "../lib/stowFolders.js";

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
 * Backs up known conflict files (`.zshrc`, `.editorconfig`, ghostty config,
 * nvim directory) before stowing the public dotfiles. Private dotfiles are
 * stowed afterwards if available.
 */
export const install = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;
  const launcher = yield* Launcher;

  yield* log.section("Backup");
  yield* Effect.sync(() => backupPublicFiles(config.publicDotfiles));
  yield* log.info("Backed up existing files (if any)");

  yield* log.section("Install Public Dotfiles");
  yield* stowRepo(config.publicDotfiles, "public", "install", launcher, log);

  if (config.canUsePrivate && config.privateDotfiles) {
    yield* log.section("Install Private Dotfiles");
    yield* stowRepo(
      config.privateDotfiles,
      "private",
      "install",
      launcher,
      log,
    );
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
    if (!existsSync(source)) continue;

    // Skip symlinks — already managed
    try {
      if (lstatSync(source).isSymbolicLink()) continue;
    } catch {
      continue;
    }

    mkdirSync(backupDir, { recursive: true });
    const name = basename(source);
    let dest = join(backupDir, name);

    // Avoid overwriting existing backups
    if (existsSync(dest)) {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      dest = join(backupDir, `${name}.${timestamp}`);
    }

    renameSync(source, dest);
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
      if (folder === "agents") {
        flags.push("--no-folding");
        if (scope === "private") {
          flags.push(...AGENTS_PRIVATE_IGNORES);
        }
      }

      // Install mode uses --adopt for public scope
      if (scope === "public") {
        flags.push("--adopt");
      }

      const stowCmd = ["stow", ...flags, folder].join(" ");
      const exit = yield* launcher.stream(stowCmd, { cwd: repoDir });

      if (exit !== 0) {
        yield* log.error(`[${scope}] stow ${folder} failed (exit ${exit})`);
        return yield* Effect.fail(
          new LauncherError(`${scope} install stow failed on ${folder}`, exit),
        );
      }
    }
  });
