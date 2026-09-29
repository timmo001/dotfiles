import { Effect } from "effect";
import { lstatSync, readdirSync, readlinkSync, statSync } from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher, LauncherError } from "../services/Launcher.js";
import {
  INTERNAL_STOW_FOLDERS,
  listStowFolders,
  requiresNoFolding,
} from "../lib/stowFolders.js";
import { displayPath, HOME_DIR } from "../lib/paths.js";
import {
  ensureHyprConfigLink,
  ensureHyprHostLink,
} from "../lib/omarchyHost.js";
import { ensureNvimThemeLink } from "../lib/omarchyNvim.js";
import { applyOmarchyShellConfig } from "../lib/omarchyShellConfig.js";
import {
  deployOmarchyPlugin,
  omarchyPluginSubmodules,
} from "../lib/omarchyPluginDeployment.js";
import {
  writeCaptureRepositoryOptions,
  writeRepoPicker,
  writeRepoShortcuts,
} from "../lib/repoShortcuts.js";
import { captureRepositoryOptions } from "./NotesCaptureSync.js";
import { writeAllCompletions } from "./Completions.js";
import { installOpencodePluginDependencies } from "../lib/opencodePlugins.js";
import {
  backupUnmanagedStowTargets,
  backupLegacyGhosttyRepo,
  formatBackupMove,
  findExternalSkillSymlinks,
  removeExternalSymlinks,
  removeStowedSkillOwner,
  removeStaleSkillSymlinks,
  removeRetiredPublicStowLinks,
  removeRetiredPrivateCrashHook,
  removeLegacyUwsmRepo,
  restoreExternalSymlinks,
  type ExternalSymlink,
} from "../lib/stowConflicts.js";
import { cliStyler } from "../lib/ansi.js";
import { plural } from "../lib/runSummary.js";
import type { ConfigService } from "../services/Config.js";
import type { OutputLogService } from "../services/OutputLog.js";

/** Result of a stow run. */
export interface StowResult {
  /** Whether the generated Omarchy `shell.json` changed. */
  readonly shellConfigChanged: boolean;
  /** Actions taken, for a closing summary. */
  readonly actions: readonly string[];
}

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
 * @returns Whether the generated Omarchy `shell.json` changed, so the caller
 *   can reload the running shell, and the actions taken for a summary.
 */
export const stow = (opts?: {
  readonly publicOnly?: boolean;
  readonly privateOnly?: boolean;
}) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const launcher = yield* Launcher;
    const style = cliStyler();

    const runPublic = !opts?.privateOnly;
    const runPrivate = !opts?.publicOnly;

    let shellConfigChanged = false;
    const actions: string[] = [];

    const counts: StowCounts = {
      public: 0,
      private: 0,
      deployed: 0,
      backedUp: 0,
      removed: 0,
    };

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

      const captureRepositoriesPath = yield* Effect.sync(() =>
        writeCaptureRepositoryOptions(
          config.cacheDir,
          captureRepositoryOptions(config.gitConfig.repositories),
        ),
      );

      yield* log.success(
        `Generated repository shortcuts ${style.dim(displayPath(shortcutsPath))}`,
      );
      yield* log.success(
        `Generated Herdr repository picker ${style.dim(displayPath(pickerPath))}`,
      );
      yield* log.success(
        `Generated Notes capture repositories ${style.dim(displayPath(captureRepositoriesPath))}`,
      );
      actions.push("Generated repository shortcuts and pickers");
    } else if (runPrivate && config.canUsePrivate) {
      yield* log.warn(
        "Keeping repository shortcuts because dot-git.yml is invalid",
      );
    }

    if (runPublic) {
      yield* log.section("Completions");

      const completions = yield* writeAllCompletions;

      for (const target of completions) {
        yield* log.success(`Generated ${style.dim(displayPath(target))}`);
      }

      actions.push(
        `Generated ${plural(completions.length, "completion file")}`,
      );

      yield* log.section("OpenCode Plugins");
      yield* log.success(
        `Installed dependencies ${style.dim(displayPath(yield* installOpencodePluginDependencies))}`,
      );
      actions.push("Installed OpenCode plugin dependencies");

      yield* log.section("Stow Public Dotfiles");

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

      const removedLegacyUwsm = yield* Effect.sync(() =>
        removeLegacyUwsmRepo(),
      );

      if (removedLegacyUwsm) {
        yield* log.info(
          `${style.warn("Removed")} retired UWSM repo ${style.dim(displayPath(removedLegacyUwsm))}`,
        );
        counts.removed++;
      }

      const ignoredTargets = new Set([
        join(".agents", "skills", "dotfiles-stow", "SKILL.md"),
        ...omarchyPluginSubmodules(config.publicDotfiles).map((source) =>
          relative(join(config.publicDotfiles, "omarchy"), source),
        ),
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
          `${style.warn("Backed up")} unmanaged target ${style.dim(formatBackupMove(move))}`,
        );
        counts.backedUp++;
      }

      if (
        removeStowedSkillOwner(
          "dotfiles-stow",
          join(config.publicDotfiles, "agents/.agents/skills/dotfiles-stow"),
        )
      ) {
        yield* log.info(
          `${style.warn("Migrated")} skill owner ${style.accent("dotfiles-stow")}`,
        );
      }

      yield* stowRepo(
        config.publicDotfiles,
        "public",
        launcher,
        log,
        config,
        counts,
      );
      actions.push(`Stowed ${plural(counts.public, "public package")}`);

      yield* log.section("Omarchy Neovim Theme");
      yield* ensureNvimThemeLink(log);

      yield* log.section("Omarchy Shell Config");
      shellConfigChanged = yield* applyOmarchyShellConfig;

      if (shellConfigChanged) actions.push("Regenerated Omarchy shell config");
    }

    if (runPrivate) {
      if (config.canUsePrivate && config.privateDotfiles) {
        const privateDotfiles = config.privateDotfiles;
        yield* log.section("Stow Private Dotfiles");

        const backedUp = yield* Effect.sync(() =>
          backupUnmanagedStowTargets(
            privateDotfiles,
            config,
            new Set(
              omarchyPluginSubmodules(privateDotfiles).map((source) =>
                relative(join(privateDotfiles, "omarchy"), source),
              ),
            ),
          ),
        );

        for (const move of backedUp) {
          yield* log.info(
            `${style.warn("Backed up")} unmanaged target ${style.dim(formatBackupMove(move))}`,
          );
          counts.backedUp++;
        }

        yield* stowRepo(
          privateDotfiles,
          "private",
          launcher,
          log,
          config,
          counts,
        );
        actions.push(`Stowed ${plural(counts.private, "private package")}`);
      } else {
        yield* log.warn(
          "Skipping private stow (private dotfiles not available)",
        );
      }
    }

    if (counts.deployed > 0)
      actions.push(`Deployed ${plural(counts.deployed, "Omarchy plugin")}`);

    if (counts.backedUp > 0)
      actions.push(`Backed up ${plural(counts.backedUp, "unmanaged target")}`);

    if (counts.removed > 0)
      actions.push(`Removed ${plural(counts.removed, "retired link")}`);

    return { shellConfigChanged, actions } satisfies StowResult;
  });

/** Packages with per-package stow handling that cannot share a batch. */
const UNBATCHED_FOLDERS = new Set(["agents", "hypr", "omarchy"]);

interface StowCounts {
  public: number;
  private: number;
  deployed: number;
  backedUp: number;
  removed: number;
}

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
  log: Pick<OutputLogService, "info" | "success" | "warn" | "error">,
  config: ConfigService,
  counts: StowCounts,
) =>
  Effect.gen(function* () {
    const folders = listStowFolders(repoDir, config).sort();
    const repoDisplayPath = displayPath(repoDir);
    const style = cliStyler();

    yield* log.info(style.dim(repoDisplayPath));

    if (scope === "public") {
      yield* unstowLegacyInternalFolders(
        repoDir,
        repoDisplayPath,
        launcher,
        log,
      );
    }

    const stowFolder = (folder: string) =>
      Effect.gen(function* () {
        const isHypr = folder === "hypr";

        const plugins =
          folder === "omarchy" ? omarchyPluginSubmodules(repoDir) : [];

        const pluginIgnores = plugins.map(
          (source) =>
            `--ignore='^\\.config/omarchy/plugins/${basename(source).replaceAll(".", "\\.")}($|/)'`,
        );

        if (isHypr) {
          // Never unstow hypr: Hyprland watches its live config and auto-reloads
          // on change. Removing the symlinks (even briefly) drops Hyprland into
          // emergency mode, and it may regenerate a stub real config file
          // that then blocks the restow. Repair the link atomically instead and
          // let the idempotent stow below fill in any missing files with no gap.
          yield* ensureHyprConfigLink(repoDir, log);
        } else {
          // Unstow first, then restow (equivalent to --restow per folder)
          const unstowCmd = ["stow", "-D", folder, ...pluginIgnores].join(" ");

          const unstowExit = yield* launcher.stream(unstowCmd, {
            cwd: repoDir,
          });

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
        const flags: string[] = [...pluginIgnores];
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
              `${style.warn("Removed")} stale skill link ${style.dim(displayPath(path))}`,
            );
            counts.removed++;
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

        yield* log.success(style.accent(folder));
        counts[scope]++;

        for (const source of plugins) {
          const deployed = yield* deployOmarchyPlugin(
            source,
            join(HOME_DIR, ".config/omarchy/plugins", basename(source)),
            repoDir,
          );

          if (deployed) {
            yield* log.success(
              `Deployed Omarchy plugin ${style.dim(displayPath(deployed.target))}`,
            );
            counts.deployed++;

            if (deployed.backup)
              yield* log.info(
                `  ${style.dim(`Previous plugin saved: ${displayPath(deployed.backup)}`)}`,
              );
          }
        }

        // Apply any added or changed config and clear any prior emergency state.
        // Ignore failure: Hyprland may not be running (headless, SSH).
        if (isHypr) {
          yield* ensureHyprHostLink(config, log);
          yield* launcher
            .stream("hyprctl reload", { cwd: repoDir })
            .pipe(Effect.catch(() => Effect.void));
        }
      });

    // Plain packages restow together, one stow process per folding mode.
    // Stow aborts before changing anything on a conflict, so a failed batch
    // falls back to per-package runs that name the failing package.
    const batched = folders.filter((folder) => !UNBATCHED_FOLDERS.has(folder));

    for (const noFolding of [false, true]) {
      const group = batched.filter(
        (folder) => requiresNoFolding(repoDir, folder) === noFolding,
      );

      if (group.length === 0) continue;

      const stowCmd = [
        "stow",
        "-R",
        ...(noFolding ? ["--no-folding"] : []),
        ...group,
      ].join(" ");

      const exit = yield* launcher.stream(stowCmd, { cwd: repoDir });

      if (exit !== 0) {
        yield* log.warn(
          `[${scope}] batched stow failed (exit ${exit}); retrying one package at a time`,
        );

        for (const folder of group) yield* stowFolder(folder);

        continue;
      }

      for (const folder of group) {
        yield* log.success(style.accent(folder));
        counts[scope]++;
      }
    }

    for (const folder of folders) {
      if (UNBATCHED_FOLDERS.has(folder)) yield* stowFolder(folder);
    }
  });

/** Whether any home link still points into a retired package directory. */
function hasStowLinksInto(
  root: string,
  packageDir: string,
  targetDir: string,
): boolean {
  let entries: string[];

  try {
    entries = readdirSync(packageDir);
  } catch {
    return false;
  }

  return entries.some((entry) => {
    const target = join(targetDir, entry);

    try {
      const stat = lstatSync(target);

      if (stat.isSymbolicLink()) {
        const destination = resolve(dirname(target), readlinkSync(target));

        return destination === root || destination.startsWith(`${root}/`);
      }

      const source = join(packageDir, entry);

      return (
        stat.isDirectory() &&
        statSync(source).isDirectory() &&
        hasStowLinksInto(root, source, target)
      );
    } catch {
      return false;
    }
  });
}

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
      const packageDir = join(repoDir, folder);

      if (!hasStowLinksInto(packageDir, packageDir, HOME_DIR)) continue;

      const style = cliStyler();

      yield* log.info(
        `${style.warn("Unstowing")} legacy ${style.accent(folder)} ${style.dim(`(${displayPath})`)}`,
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
