import { Effect, type FileSystem } from "effect";
import { basename, dirname, join, relative, resolve } from "path";
import { lstatOrNull, readDirectoryOrNull, readLinkOrNull } from "./fsProbe.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher, LauncherError } from "../services/Launcher.js";
import {
  INTERNAL_STOW_FOLDERS,
  listStowFolders,
  requiresNoFolding,
} from "./stowFolders.js";
import { displayPath, HOME_DIR } from "./paths.js";
import { foldOpencodePluginFolders } from "./opencodePluginFolders.js";
import { ensureHyprConfigLink, ensureHyprHostLink } from "./omarchyHost.js";
import {
  deployOmarchyPlugin,
  omarchyPluginSubmodules,
} from "./omarchyPluginDeployment.js";
import {
  backupLegacyGhosttyRepo,
  backupUnmanagedStowTargets,
  findExternalSkillSymlinks,
  formatBackupMove,
  removeExternalSymlinks,
  removeLegacyUwsmRepo,
  removeRetiredPrivateCrashHook,
  removeRetiredPublicStowLinks,
  removeStaleSkillSymlinks,
  restoreExternalSymlinks,
  type ExternalSymlink,
} from "./stowConflicts.js";
import { cliStyler } from "./ansi.js";

/** Which dotfiles repository a stow run targets. */
export type StowScope = "public" | "private";

/** Running totals for a stow or install run summary. */
export interface StowCounts {
  /** Public packages stowed. */
  public: number;
  /** Private packages stowed. */
  private: number;
  /** Omarchy plugins deployed as real-file copies. */
  deployed: number;
  /** Live targets moved to a backup directory. */
  backedUp: number;
  /** Retired links or repositories removed. */
  removed: number;
}

/** Create zeroed {@link StowCounts}. */
export function emptyStowCounts(): StowCounts {
  return { public: 0, private: 0, deployed: 0, backedUp: 0, removed: 0 };
}

/** Extra stow flags for the private agents folder. */
const AGENTS_PRIVATE_IGNORES = [
  "--ignore=node_modules",
  "--ignore='package\\.json'",
  "--ignore='bun\\.lock'",
  "--ignore='\\.gitignore'",
];

/** Packages with per-package stow handling that cannot share a batch. */
const UNBATCHED_FOLDERS = new Set(["agents", "hypr", "omarchy"]);

/**
 * Run one stow command for a package, failing with a logged
 * {@link LauncherError} on a non-zero exit.
 */
export const runStow = Effect.fn("stow.run")(function* (
  repoDir: string,
  scope: StowScope,
  action: string,
  folder: string,
  args: readonly string[],
) {
  const launcher = yield* Launcher;
  const log = yield* OutputLog;

  const exit = yield* launcher.stream(["stow", ...args].join(" "), {
    cwd: repoDir,
  });

  if (exit === 0) return;

  yield* log.error(`[${scope}] ${action} ${folder} failed (exit ${exit})`);

  return yield* new LauncherError({
    message: `${scope} ${action} failed on ${folder}`,
    exitCode: exit,
  });
});

/** Home-relative plugin paths that are deployed rather than stowed. */
const pluginTargets = Effect.fn("stow.pluginTargets")(function* (
  repoDir: string,
) {
  return (yield* omarchyPluginSubmodules(repoDir)).map((source) =>
    relative(join(repoDir, "omarchy"), source),
  );
});

/**
 * Remove or back up retired links and cloned repositories that would
 * otherwise conflict with stowing the public packages.
 */
export const removeRetiredStowState = Effect.fn("stow.removeRetiredState")(
  function* (counts: StowCounts) {
    const config = yield* Config;
    const log = yield* OutputLog;
    const style = cliStyler();

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
  },
);

/**
 * Move unmanaged live files that block a repository's packages into its
 * backup directory. Deployed Omarchy plugins are always left alone.
 */
export const backupUnmanagedTargets = Effect.fn("stow.backupUnmanaged")(
  function* (
    repoDir: string,
    counts: StowCounts,
    extraIgnored: readonly string[] = [],
  ) {
    const config = yield* Config;
    const log = yield* OutputLog;
    const style = cliStyler();

    const folders = (yield* listStowFolders(repoDir, config)).sort();
    const pluginTargetList = yield* pluginTargets(repoDir);

    const moves = yield* Effect.sync(() =>
      backupUnmanagedStowTargets(
        repoDir,
        folders,
        new Set([...extraIgnored, ...pluginTargetList]),
      ),
    );

    for (const move of moves) {
      yield* log.info(
        `${style.warn("Backed up")} unmanaged target ${style.dim(formatBackupMove(move))}`,
      );
      counts.backedUp++;
    }
  },
);

/**
 * Stow every package in a repository.
 *
 * Plain packages restow together, one stow process per folding mode. Stow
 * aborts before changing anything on a conflict, so a failed batch falls back
 * to per-package runs that name the failing package. `hypr` is never
 * unstowed, and Omarchy plugins are deployed as real-file copies.
 *
 * @param adopt Pass `--adopt` for the public repository during install.
 */
export const stowRepo = Effect.fn("stow.repo")(function* (
  repoDir: string,
  scope: StowScope,
  counts: StowCounts,
  options: { readonly adopt?: boolean } = {},
) {
  const config = yield* Config;
  const log = yield* OutputLog;
  const launcher = yield* Launcher;
  const folders = (yield* listStowFolders(repoDir, config)).sort();
  const repoDisplayPath = displayPath(repoDir);
  const style = cliStyler();
  const adoptFlags = options.adopt ? ["--adopt"] : [];

  yield* log.info(style.dim(repoDisplayPath));

  if (scope === "public") yield* unstowLegacyInternalFolders(repoDir);

  const stowFolder = (folder: string) =>
    Effect.gen(function* () {
      const isHypr = folder === "hypr";

      const plugins =
        folder === "omarchy" ? yield* omarchyPluginSubmodules(repoDir) : [];

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
        yield* runStow(repoDir, scope, "unstow", folder, [
          "-D",
          folder,
          ...pluginIgnores,
        ]);
      }

      const flags: string[] = [...pluginIgnores, ...adoptFlags];
      let externalLinks: ExternalSymlink[] = [];

      // Some packages must stay real directories (not folded symlinks) so
      // runtime symlinks, host overrides, and tool-generated files can live
      // alongside the stowed config. See requiresNoFolding for the rationale.
      if (yield* requiresNoFolding(repoDir, folder)) flags.push("--no-folding");

      if (folder === "agents") {
        // A retired skills submodule checkout can linger after a pull.
        if (scope === "public") {
          flags.push("--ignore='^/\\.agents/skills($|/)'");
        }

        for (const path of removeStaleSkillSymlinks(repoDir)) {
          yield* log.info(
            `${style.warn("Removed")} stale skill link ${style.dim(displayPath(path))}`,
          );
          counts.removed++;
        }

        if (scope === "private") flags.push(...AGENTS_PRIVATE_IGNORES);

        // Temporarily remove external symlinks that would conflict with stow
        externalLinks = findExternalSkillSymlinks(repoDir);

        if (externalLinks.length > 0) removeExternalSymlinks(externalLinks);
      }

      // Restore external symlinks regardless of stow success
      yield* runStow(repoDir, scope, "stow", folder, [...flags, folder]).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (externalLinks.length > 0)
              restoreExternalSymlinks(externalLinks);
          }),
        ),
      );

      yield* log.success(style.accent(folder));
      counts[scope]++;

      if (folder === "agents") yield* foldOpencodePluginFolders(repoDir);

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

  const batched = folders.filter((folder) => !UNBATCHED_FOLDERS.has(folder));

  for (const noFolding of [false, true]) {
    const group: string[] = [];

    for (const folder of batched) {
      if ((yield* requiresNoFolding(repoDir, folder)) === noFolding) {
        group.push(folder);
      }
    }

    if (group.length === 0) continue;

    const stowCmd = [
      "stow",
      "-R",
      ...(noFolding ? ["--no-folding"] : []),
      ...adoptFlags,
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
const hasStowLinksInto = Effect.fn("stow.hasLinksInto")(function* (
  root: string,
  packageDir: string,
  targetDir: string,
): Effect.fn.Return<boolean, never, FileSystem.FileSystem> {
  const entries = yield* readDirectoryOrNull(packageDir);

  if (entries === null) return false;

  for (const entry of entries) {
    const target = join(targetDir, entry);
    const link = yield* readLinkOrNull(target);

    if (link !== null) {
      const destination = resolve(dirname(target), link);

      if (destination === root || destination.startsWith(`${root}/`)) {
        return true;
      }

      continue;
    }

    const source = join(packageDir, entry);

    if (
      (yield* lstatOrNull(target))?.type === "Directory" &&
      (yield* lstatOrNull(source))?.type === "Directory" &&
      (yield* hasStowLinksInto(root, source, target))
    ) {
      return true;
    }
  }

  return false;
});

/** Remove links left behind by packages that are no longer stowed. */
const unstowLegacyInternalFolders = Effect.fn("stow.unstowLegacyInternal")(
  function* (repoDir: string) {
    const log = yield* OutputLog;
    const style = cliStyler();

    for (const folder of INTERNAL_STOW_FOLDERS) {
      const packageDir = join(repoDir, folder);

      if (!(yield* hasStowLinksInto(packageDir, packageDir, HOME_DIR)))
        continue;

      yield* log.info(
        `${style.warn("Unstowing")} legacy ${style.accent(folder)} ${style.dim(`(${displayPath(repoDir)})`)}`,
      );

      yield* runStow(repoDir, "public", "unstow legacy", folder, [
        "-D",
        folder,
      ]);
    }
  },
);
