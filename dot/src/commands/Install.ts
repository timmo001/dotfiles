import { Effect } from "effect";
import { join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher, LauncherError } from "../services/Launcher.js";
import { HOME_DIR, displayPath } from "../lib/paths.js";
import { ensureStowInstalled } from "../lib/packageSetup.js";
import { applyOmarchyShellConfig } from "../lib/omarchyShellConfig.js";
import { listStowFolders } from "../lib/stowFolders.js";
import {
  backupConflictingPublicTargets,
  backupFileIfUnmanaged,
  formatBackupMove,
  type BackupMove,
} from "../lib/stowConflicts.js";
import {
  backupUnmanagedTargets,
  emptyStowCounts,
  removeRetiredStowState,
  stowRepo,
} from "../lib/stowPackages.js";
import { writeAllCompletions } from "./Completions.js";
import { installOpencodePluginDependencies } from "../lib/opencodePlugins.js";
import { cliStyler } from "../lib/ansi.js";
import { plural } from "../lib/runSummary.js";

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
  const counts = emptyStowCounts();

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
  yield* removeRetiredStowState(counts);

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
  const publicFolders = (yield* listStowFolders(
    config.publicDotfiles,
    config,
  )).sort();

  const protectedTargets = yield* Effect.sync(() =>
    backupConflictingPublicTargets(config.publicDotfiles, publicFolders),
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

  yield* stowRepo(config.publicDotfiles, "public", counts, { adopt: true });
  actions.push(`Stowed ${plural(counts.public, "public package")}`);
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
    yield* log.section("Install Private Dotfiles");
    yield* backupUnmanagedTargets(config.privateDotfiles, counts);
    yield* stowRepo(config.privateDotfiles, "private", counts);
    actions.push(`Stowed ${plural(counts.private, "private package")}`);
  } else {
    yield* log.warn(
      "Skipping private install (private dotfiles not available)",
    );
  }

  if (counts.deployed > 0)
    actions.push(`Deployed ${plural(counts.deployed, "Omarchy plugin")}`);

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
