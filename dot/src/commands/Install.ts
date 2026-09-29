import { Effect } from "effect";
import { join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher, LauncherError } from "../services/Launcher.js";
import { listStowFolders, requiresNoFolding } from "../lib/stowFolders.js";
import { HOME_DIR, displayPath } from "../lib/paths.js";
import {
  ensureHyprConfigLink,
  ensureHyprHostLink,
} from "../lib/omarchyHost.js";
import { ensureStowInstalled } from "../lib/packageSetup.js";
import { applyOmarchyShellConfig } from "../lib/omarchyShellConfig.js";
import {
  backupConflictingPublicTargets,
  backupFileIfUnmanaged,
  backupLegacyGhosttyRepo,
  backupUnmanagedStowTargets,
  formatBackupMove,
  findExternalSkillSymlinks,
  removeExternalSymlinks,
  removeRetiredPrivateCrashHook,
  removeRetiredPublicStowLinks,
  removeLegacyUwsmRepo,
  restoreExternalSymlinks,
  type BackupMove,
  type ExternalSymlink,
} from "../lib/stowConflicts.js";
import type { ConfigService } from "../services/Config.js";
import { writeAllCompletions } from "./Completions.js";
import { installOpencodePluginDependencies } from "../lib/opencodePlugins.js";
import { cliStyler } from "../lib/ansi.js";
import { plural } from "../lib/runSummary.js";
import type { OutputLogService } from "../services/OutputLog.js";

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
 * Ensures stow is installed, backs up known conflict files and retired cloned
 * config repos, then stows public and private dotfiles.
 */
export const install = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;
  const launcher = yield* Launcher;
  const style = cliStyler();
  const actions: string[] = [];
  const counts = { backedUp: 0, removed: 0 };

  yield* ensureStowInstalled;

  yield* log.section("Completions");

  const completions = yield* writeAllCompletions;

  for (const target of completions) {
    yield* log.success(`Generated ${style.dim(displayPath(target))}`);
  }

  actions.push(`Generated ${plural(completions.length, "completion file")}`);

  yield* log.section("OpenCode Plugins");
  yield* log.success(
    `Installed dependencies ${style.dim(displayPath(yield* installOpencodePluginDependencies))}`,
  );
  actions.push("Installed OpenCode plugin dependencies");

  yield* log.section("Backup");

  if (config.privateDotfiles) {
    const privateDotfiles = config.privateDotfiles;

    const removedPrivateCrashHook = yield* Effect.sync(() =>
      removeRetiredPrivateCrashHook(privateDotfiles),
    );

    if (removedPrivateCrashHook) {
      yield* log.info(
        `${style.warn("Migrated")} crash hook to public stow ${style.dim(displayPath(removedPrivateCrashHook))}`,
      );
    }
  }

  for (const path of removeRetiredPublicStowLinks(config.publicDotfiles)) {
    yield* log.info(
      `${style.warn("Removed")} retired stow link ${style.dim(displayPath(path))}`,
    );
    counts.removed++;
  }

  const legacyGhosttyMove = yield* Effect.sync(() =>
    backupLegacyGhosttyRepo(config.publicDotfiles),
  );

  if (legacyGhosttyMove) {
    yield* log.info(
      `${style.warn("Backed up")} retired Ghostty repo ${style.dim(formatBackupMove(legacyGhosttyMove))}`,
    );
    counts.backedUp++;
  }

  const removedLegacyUwsm = yield* Effect.sync(() => removeLegacyUwsmRepo());

  if (removedLegacyUwsm) {
    yield* log.info(
      `${style.warn("Removed")} retired UWSM repo ${style.dim(displayPath(removedLegacyUwsm))}`,
    );
    counts.removed++;
  }

  const knownMoves = yield* Effect.sync(() =>
    backupPublicFiles(config.publicDotfiles),
  );

  for (const move of knownMoves) {
    yield* log.info(
      `${style.warn("Backed up")} existing file ${style.dim(formatBackupMove(move))}`,
    );
    counts.backedUp++;
  }

  // Committed-wins pre-pass: move live files that differ from their committed
  // source out of the way so the public `--adopt` stow symlinks the committed
  // config instead of overwriting the repo with stock leftovers.
  const protectedTargets = yield* Effect.sync(() =>
    backupConflictingPublicTargets(config.publicDotfiles, config),
  );

  if (protectedTargets.length > 0) {
    yield* log.info(
      `${style.warn("Protected")} ${plural(protectedTargets.length, "public stow target")} from --adopt ${style.dim("(live copies moved to backup/)")}`,
    );

    for (const move of protectedTargets) {
      yield* log.info(`  ${style.dim(formatBackupMove(move))}`);
    }

    counts.backedUp += protectedTargets.length;
  }

  if (counts.backedUp === 0 && counts.removed === 0) {
    yield* log.info(style.dim("Nothing to back up"));
  }

  yield* log.section("Install Public Dotfiles");
  const beforeStow = yield* publicRepoStatus(config.publicDotfiles, launcher);

  const publicCount = yield* stowRepo(
    config.publicDotfiles,
    "public",
    "install",
    launcher,
    log,
    config,
  );

  actions.push(`Stowed ${plural(publicCount, "public package")}`);
  yield* warnIfAdoptDirtiedRepo(
    config.publicDotfiles,
    beforeStow,
    launcher,
    log,
  );

  yield* log.section("Omarchy Shell Config");

  if (yield* applyOmarchyShellConfig)
    actions.push("Regenerated Omarchy shell config");

  if (config.canUsePrivate && config.privateDotfiles) {
    const privateDotfiles = config.privateDotfiles;
    yield* log.section("Install Private Dotfiles");

    const privateMoves = yield* Effect.sync(() =>
      backupUnmanagedStowTargets(privateDotfiles, config),
    );

    for (const move of privateMoves) {
      yield* log.info(
        `${style.warn("Backed up")} unmanaged target ${style.dim(formatBackupMove(move))}`,
      );
      counts.backedUp++;
    }

    const privateCount = yield* stowRepo(
      privateDotfiles,
      "private",
      "install",
      launcher,
      log,
      config,
    );

    actions.push(`Stowed ${plural(privateCount, "private package")}`);
  } else {
    yield* log.warn(
      "Skipping private install (private dotfiles not available)",
    );
  }

  if (counts.backedUp > 0)
    actions.push(`Backed up ${plural(counts.backedUp, "existing file")}`);

  if (counts.removed > 0)
    actions.push(`Removed ${plural(counts.removed, "retired link")}`);

  const result: readonly string[] = actions;

  return result;
});

/**
 * Backup known files that may conflict with public stow packages.
 * Skips symlinks (already managed). Moves real files into `$repo/backup/`.
 */
function backupPublicFiles(publicDotfiles: string): BackupMove[] {
  const backupRoot = join(publicDotfiles, "backup");
  const moves: BackupMove[] = [];

  const targets = [
    { source: join(HOME_DIR, ".zshrc"), backupDir: backupRoot },
    { source: join(HOME_DIR, ".editorconfig"), backupDir: backupRoot },
    {
      source: join(HOME_DIR, ".config/nvim"),
      backupDir: join(backupRoot, ".config"),
    },
  ];

  for (const { source, backupDir } of targets) {
    const move = backupFileIfUnmanaged(source, backupDir);

    if (move) moves.push(move);
  }

  return moves;
}

/** Read `git status --porcelain` for a repo, returning "" on failure. */
const publicRepoStatus = (
  repoDir: string,
  launcher: {
    readonly silent: (cmd: string) => Effect.Effect<string, LauncherError>;
  },
) =>
  launcher
    .silent(`git -C '${repoDir}' status --porcelain`)
    .pipe(Effect.catch(() => Effect.succeed("")));

/** Collect the home-relative paths that already have a working-tree status. */
function dirtyPaths(porcelain: string): Set<string> {
  const paths = new Set<string>();

  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue;
    paths.add(line.slice(3));
  }

  return paths;
}

/**
 * Warn when `stow --adopt` overwrote committed files in the public repo.
 *
 * Diffs the repo's working-tree status before and after stowing and flags
 * tracked files that became dirty during the adopt, pointing at the
 * `git restore` remedy. Pre-existing local edits are ignored so the warning
 * only fires on genuine adopt clobbering the committed-wins pre-pass missed.
 */
const warnIfAdoptDirtiedRepo = (
  repoDir: string,
  before: string,
  launcher: {
    readonly silent: (cmd: string) => Effect.Effect<string, LauncherError>;
  },
  log: { readonly warn: (msg: string) => Effect.Effect<void> },
) =>
  Effect.gen(function* () {
    const after = yield* publicRepoStatus(repoDir, launcher);
    const beforeDirty = dirtyPaths(before);

    const adopted: string[] = [];

    for (const line of after.split("\n")) {
      if (line.length < 4) continue;
      const status = line.slice(0, 2);
      const path = line.slice(3);

      if (status === "??" || beforeDirty.has(path)) continue;
      adopted.push(path);
    }

    if (adopted.length === 0) return;

    yield* log.warn("stow --adopt changed committed files in the public repo:");

    for (const path of adopted) {
      yield* log.warn(`  ${path}`);
    }

    yield* log.warn(
      `Review: ${cliStyler().command(`git -C ${displayPath(repoDir)} diff`)}`,
    );
    yield* log.warn(
      `Discard leftovers: ${cliStyler().command(`git -C ${displayPath(repoDir)} restore <path>`)}`,
    );
  });

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
  log: Pick<OutputLogService, "info" | "success" | "warn" | "error">,
  config: ConfigService,
) =>
  Effect.gen(function* () {
    const folders = listStowFolders(repoDir, config).sort();
    const style = cliStyler();

    yield* log.info(style.dim(displayPath(repoDir)));

    for (const folder of folders) {
      const isHypr = scope === "public" && folder === "hypr";

      if (isHypr) {
        yield* ensureHyprConfigLink(repoDir, log);
      } else {
        // Unstow first (clean slate). Hyprland is excluded because removing
        // hyprland.lua even briefly makes its live reload enter emergency mode.
        const unstowExit = yield* launcher.stream(`stow -D ${folder}`, {
          cwd: repoDir,
        });

        if (unstowExit !== 0) {
          yield* log.error(
            `[${scope}] unstow ${folder} failed (exit ${unstowExit})`,
          );

          return yield* new LauncherError({
            message: `${scope} install unstow failed on ${folder}`,
            exitCode: unstowExit,
          });
        }
      }

      // Build stow command with folder-specific flags
      const flags: string[] = [];
      let externalLinks: ExternalSymlink[] = [];

      if (requiresNoFolding(repoDir, folder)) {
        flags.push("--no-folding");
      }

      if (folder === "agents") {
        if (scope === "private") {
          flags.push(...AGENTS_PRIVATE_IGNORES);
        }

        externalLinks = findExternalSkillSymlinks(repoDir);

        if (externalLinks.length > 0) {
          removeExternalSymlinks(externalLinks);
        }
      }

      // Keep ~/.config/hypr a real directory so the runtime host symlink and
      // Hyprland runtime state live in the live tree, not the stow source.
      if (folder === "hypr") {
        flags.push("--no-folding");
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

        return yield* new LauncherError({
          message: `${scope} install stow failed on ${folder}`,
          exitCode: exit,
        });
      }

      yield* log.success(style.accent(folder));

      // Apply any added or changed config and clear any prior emergency state.
      // Ignore failure: Hyprland may not be running (fresh install, headless).
      if (isHypr) {
        yield* ensureHyprHostLink(config, log);
        yield* launcher
          .stream("hyprctl reload", { cwd: repoDir })
          .pipe(Effect.catch(() => Effect.void));
      }
    }

    return folders.length;
  });
