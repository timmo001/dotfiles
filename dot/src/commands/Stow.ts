import { Effect } from "effect";
import { existsSync } from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher, LauncherError } from "../services/Launcher.js";
import {
  INTERNAL_STOW_FOLDERS,
  listStowFolders,
  requiresNoFolding,
} from "../lib/stowFolders.js";
import { displayPath } from "../lib/paths.js";
import {
  ensureHyprConfigLink,
  ensureHyprHostLink,
} from "../lib/omarchyHost.js";
import { ensureNvimThemeLink } from "../lib/omarchyNvim.js";
import { applyOmarchyShellConfig } from "../lib/omarchyShellConfig.js";
import { writeRepoPicker, writeRepoShortcuts } from "../lib/repoShortcuts.js";
import {
  backupUnmanagedStowTargets,
  backupLegacyGhosttyRepo,
  formatBackupMove,
  findExternalSkillSymlinks,
  removeExternalSymlinks,
  removeStowedSkillOwner,
  removeStaleSkillSymlinks,
  removeRetiredPublicStowLinks,
  removeLegacyUwsmRepo,
  restoreExternalSymlinks,
  type ExternalSymlink,
} from "../lib/stowConflicts.js";
import type { ConfigService } from "../services/Config.js";

/** Extra stow flags for the agents folder (matches legacy behaviour) */
const AGENTS_PRIVATE_IGNORES = [
  "--ignore=node_modules",
  "--ignore='package\\.json'",
  "--ignore='bun\\.lock'",
  "--ignore='\\.gitignore'",
];

/**
 * Run GNU Stow per-folder for the public and (optionally) private dotfiles repos.
 *
 * Matches legacy behaviour: enumerates stow package directories, logs each one,
 * and applies per-folder stow with appropriate flags.
 *
 * @returns `true` when the generated Omarchy `shell.json` changed during this
 *   run, so the caller can reload the running shell. Always `false` for
 *   private-only runs or when the shell config step is skipped.
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

    let shellConfigChanged = false;

    if (runPrivate && config.canUsePrivate && config.gitConfig.valid) {
      const shortcutsPath = yield* Effect.sync(() =>
        writeRepoShortcuts(config.cacheDir, [
          ...config.gitConfig.repositories,
          ...config.gitConfig.shortcuts,
        ]),
      );
      const pickerPath = yield* Effect.sync(() =>
        writeRepoPicker(config.cacheDir, [
          ...config.gitConfig.repositories,
          ...config.gitConfig.shortcuts,
        ]),
      );
      yield* log.info(
        `Generated repository shortcuts: ${displayPath(shortcutsPath)}`,
      );
      yield* log.info(
        `Generated Herdr repository picker: ${displayPath(pickerPath)}`,
      );
    } else if (runPrivate && config.canUsePrivate) {
      yield* log.warn(
        "Keeping repository shortcuts because dot-git.yml is invalid",
      );
    }

    if (runPublic) {
      yield* log.section("Stow Public Dotfiles");
      for (const path of removeRetiredPublicStowLinks(config.publicDotfiles)) {
        yield* log.info(`Removed retired stow link: ${displayPath(path)}`);
      }
      const legacyGhosttyMove = yield* Effect.sync(() =>
        backupLegacyGhosttyRepo(config.publicDotfiles),
      );
      if (legacyGhosttyMove) {
        yield* log.info(
          `[public] backed up retired Ghostty repo: ${formatBackupMove(legacyGhosttyMove)}`,
        );
      }
      const removedLegacyUwsm = yield* Effect.sync(() =>
        removeLegacyUwsmRepo(),
      );
      if (removedLegacyUwsm) {
        yield* log.info(
          `[public] removed retired UWSM repo: ${displayPath(removedLegacyUwsm)}`,
        );
      }
      const ignoredTargets = new Set([
        join(".agents", "skills", "dotfiles-stow", "SKILL.md"),
      ]);
      const backedUp = yield* Effect.sync(() =>
        backupUnmanagedStowTargets(
          config.publicDotfiles,
          config,
          ignoredTargets,
        ),
      );
      for (const move of backedUp) {
        yield* log.info(
          `[public] backed up unmanaged target: ${formatBackupMove(move)}`,
        );
      }
      if (
        removeStowedSkillOwner(
          "dotfiles-stow",
          join(config.publicDotfiles, "agents/.agents/skills/dotfiles-stow"),
        )
      ) {
        yield* log.info("[public] migrated skill owner: dotfiles-stow");
      }
      yield* stowRepo(config.publicDotfiles, "public", launcher, log, config);

      const reloadUiMonitorUnit = "dot-reload-ui-monitor.service";
      const reloadUiMonitorPath = join(
        config.omarchy.repoBase,
        "systemd",
        "user",
        reloadUiMonitorUnit,
      );
      if (config.omarchy.enabled && existsSync(reloadUiMonitorPath)) {
        yield* log.section("Reload UI Monitor");
        const daemonReloadExit = yield* launcher.stream(
          "systemctl --user daemon-reload",
        );
        const enableExit =
          daemonReloadExit === 0
            ? yield* launcher.stream(
                `systemctl --user enable --now ${reloadUiMonitorUnit}`,
              )
            : daemonReloadExit;
        if (enableExit === 0) {
          yield* log.info(`Enabled ${reloadUiMonitorUnit}`);
        } else {
          yield* log.warn(
            `Could not enable ${reloadUiMonitorUnit} (systemctl exit ${enableExit})`,
          );
        }
      }

      yield* log.section("Omarchy Neovim Theme");
      yield* ensureNvimThemeLink(log);

      yield* log.section("Omarchy Shell Config");
      shellConfigChanged = yield* applyOmarchyShellConfig;
    }

    if (runPrivate) {
      if (config.canUsePrivate && config.privateDotfiles) {
        const privateDotfiles = config.privateDotfiles;
        yield* log.section("Stow Private Dotfiles");
        const backedUp = yield* Effect.sync(() =>
          backupUnmanagedStowTargets(privateDotfiles, config),
        );
        for (const move of backedUp) {
          yield* log.info(
            `[private] backed up unmanaged target: ${formatBackupMove(move)}`,
          );
        }
        yield* stowRepo(privateDotfiles, "private", launcher, log, config);
      } else {
        yield* log.warn(
          "Skipping private stow (private dotfiles not available)",
        );
      }
    }

    return shellConfigChanged;
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
    readonly warn: (msg: string) => Effect.Effect<void>;
    readonly error: (msg: string) => Effect.Effect<void>;
  },
  config: ConfigService,
) =>
  Effect.gen(function* () {
    const folders = listStowFolders(repoDir, config).sort();
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

      const isHypr = folder === "hypr";
      if (isHypr) {
        // Never unstow hypr: Hyprland watches its live config and auto-reloads
        // on change. Removing the symlinks (even briefly) drops Hyprland into
        // emergency mode, and it may regenerate a stub real config file
        // that then blocks the restow. Repair the link atomically instead and
        // let the idempotent stow below fill in any missing files with no gap.
        yield* ensureHyprConfigLink(repoDir, log);
      } else {
        // Unstow first, then restow (equivalent to --restow per folder)
        const unstowCmd = `stow -D ${folder}`;
        const unstowExit = yield* launcher.stream(unstowCmd, { cwd: repoDir });
        if (unstowExit !== 0) {
          yield* log.error(
            `[${scope}] unstow ${folder} failed (exit ${unstowExit})`,
          );
          return yield* new LauncherError({
            message: `${scope} unstow failed on ${folder}`,
            exitCode: unstowExit,
          });
        }
      }

      // Build restow command with folder-specific flags
      const flags: string[] = [];
      let externalLinks: ExternalSymlink[] = [];
      // Some packages must stay real directories (not folded symlinks) so
      // runtime symlinks, host overrides, and tool-generated files can live
      // alongside the stowed config. See requiresNoFolding for the rationale.
      if (requiresNoFolding(repoDir, folder)) {
        flags.push("--no-folding");
      }
      if (folder === "agents") {
        if (scope === "public") {
          flags.push("--ignore='\\.agents/skills/dotfiles-stow($|/)'");
        }
        const staleSkillLinks = removeStaleSkillSymlinks(repoDir);
        for (const path of staleSkillLinks) {
          yield* log.info(
            `[${scope}] removed stale skill link: ${displayPath(path)}`,
          );
        }
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
        return yield* new LauncherError({
          message: `${scope} stow failed on ${folder}`,
          exitCode: exit,
        });
      }

      // Apply any added or changed config and clear any prior emergency state.
      // Ignore failure: Hyprland may not be running (headless, SSH).
      if (isHypr) {
        yield* ensureHyprHostLink(config, log);
        yield* launcher
          .stream("hyprctl reload", { cwd: repoDir })
          .pipe(Effect.catch(() => Effect.void));
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
        return yield* new LauncherError({
          message: `public legacy unstow failed on ${folder}`,
          exitCode: exit,
        });
      }
    }
  });
