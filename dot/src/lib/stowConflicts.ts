import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import { basename, dirname, join, relative } from "path";
import { displayPath, HOME_DIR } from "./paths.js";
import { listStowFolders } from "./stowFolders.js";
import type { ConfigService } from "../services/Config.js";

const EXTERNAL_SKILL_DIRS = [
  join(HOME_DIR, ".agents", "skills"),
  join(HOME_DIR, ".claude", "skills"),
];

const AGENTS_PRIVATE_IGNORED_ENTRIES = new Set([
  "node_modules",
  "package.json",
  "bun.lock",
  ".gitignore",
]);

const LEGACY_GHOSTTY_REPO_SLUG = "timmo001/omarchy-ghostty";

/** Stored external symlink for save/restore around stow. */
export interface ExternalSymlink {
  readonly path: string;
  readonly target: string;
}

/** A live path moved out of the way before stow claims a target. */
export interface BackupMove {
  readonly source: string;
  readonly destination: string;
}

/** Move an unmanaged path to the repo backup folder, preserving symlinks. */
export function backupFileIfUnmanaged(
  source: string,
  backupDir: string,
): BackupMove | null {
  if (!existsSync(source)) return null;

  try {
    if (lstatSync(source).isSymbolicLink()) return null;
  } catch {
    return null;
  }

  mkdirSync(backupDir, { recursive: true });
  const name = basename(source);
  let dest = join(backupDir, name);

  if (existsSync(dest)) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    dest = join(backupDir, `${name}.${timestamp}`);
  }

  renameSync(source, dest);
  return { source, destination: dest };
}

/** Format a backup move for user-facing logs. */
export function formatBackupMove(move: BackupMove): string {
  return `${displayPath(move.source)} -> ${displayPath(move.destination)}`;
}

/** Backup unmanaged targets that would block stow from owning active packages. */
export function backupUnmanagedStowTargets(
  repoDir: string,
  config: ConfigService,
): BackupMove[] {
  const backupRoot = join(repoDir, "backup");
  const moves: BackupMove[] = [];

  for (const folder of listStowFolders(repoDir, config).sort()) {
    const packageRoot = join(repoDir, folder);
    for (const { source, target } of listStowTargetPairs(packageRoot, folder)) {
      backupBlockingParentTargets(target, backupRoot, moves);
      backupTargetIfUnmanaged(source, target, backupRoot, moves);
    }
  }

  return moves;
}

/** Back up the retired cloned Ghostty Omarchy repo before stow owns it. */
export function backupLegacyGhosttyRepo(
  publicDotfiles: string,
): BackupMove | null {
  const source = join(HOME_DIR, ".config", "ghostty");
  if (!isLegacyGhosttyRepo(source)) return null;

  return backupFileIfUnmanaged(
    source,
    join(publicDotfiles, "backup", ".config"),
  );
}

/**
 * Back up live public stow targets whose content differs from their committed
 * repo source before an `--adopt` stow, returning their home-relative display
 * paths.
 *
 * `stow --adopt` imports any real file found at a target into the repo,
 * overwriting committed config (for example stock files written by an Omarchy
 * upgrade). Moving the conflicting live file to `backup/` first leaves the
 * target absent, so adopt creates a symlink to the committed source instead of
 * clobbering it. Symlinks and identical files are left untouched, so a
 * steady-state machine is a no-op.
 */
export function backupConflictingPublicTargets(
  publicDotfiles: string,
  config: ConfigService,
): BackupMove[] {
  const backupRoot = join(publicDotfiles, "backup");
  const moves: BackupMove[] = [];

  for (const folder of listStowFolders(publicDotfiles, config).sort()) {
    const packageRoot = join(publicDotfiles, folder);
    for (const { source, target } of listStowTargetPairs(packageRoot, folder)) {
      backupBlockingParentTargets(target, backupRoot, moves);
      if (liveTargetConflicts(source, target)) {
        backupTargetIfUnmanaged(source, target, backupRoot, moves);
      }
    }
  }

  return moves;
}

/** True when the live target is a real file whose bytes differ from source. */
function liveTargetConflicts(source: string, target: string): boolean {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(target);
  } catch {
    return false;
  }
  // lstat reports a symlink as a non-file, so this also skips managed targets.
  if (!stat.isFile()) return false;

  try {
    return !readFileSync(target).equals(readFileSync(source));
  } catch {
    return false;
  }
}

function backupTargetIfUnmanaged(
  source: string,
  target: string,
  backupRoot: string,
  moves: BackupMove[],
): void {
  if (targetAlreadyOwnedBySource(source, target)) return;
  if (hasUnmanagedSymlinkParent(target)) return;
  const move = backupFileIfUnmanaged(
    target,
    join(backupRoot, dirname(relative(HOME_DIR, target))),
  );
  if (move) moves.push(move);
}

function hasUnmanagedSymlinkParent(target: string): boolean {
  for (let parent = dirname(target); parent.startsWith(`${HOME_DIR}/`);) {
    try {
      if (lstatSync(parent).isSymbolicLink()) return true;
    } catch {
      // Missing ancestors cannot redirect the target outside HOME.
    }
    parent = dirname(parent);
  }
  return false;
}

function backupBlockingParentTargets(
  target: string,
  backupRoot: string,
  moves: BackupMove[],
): void {
  const parents: string[] = [];
  for (let parent = dirname(target); parent.startsWith(`${HOME_DIR}/`);) {
    parents.push(parent);
    parent = dirname(parent);
  }

  for (const parent of parents.reverse()) {
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(parent);
    } catch {
      continue;
    }
    if (stat.isDirectory() || stat.isSymbolicLink()) continue;
    const move = backupFileIfUnmanaged(
      parent,
      join(backupRoot, dirname(relative(HOME_DIR, parent))),
    );
    if (move) moves.push(move);
  }
}

function targetAlreadyOwnedBySource(source: string, target: string): boolean {
  try {
    return realpathSync(source) === realpathSync(target);
  } catch {
    return false;
  }
}

function isLegacyGhosttyRepo(source: string): boolean {
  try {
    const stat = lstatSync(source);
    if (!stat.isDirectory()) return false;
  } catch {
    return false;
  }

  const gitConfig = join(source, ".git", "config");
  if (!existsSync(gitConfig)) return false;

  try {
    return readFileSync(gitConfig, "utf8").includes(LEGACY_GHOSTTY_REPO_SLUG);
  } catch {
    return false;
  }
}

/** Find symlinks in external skill dirs that stow would otherwise reject. */
export function findExternalSkillSymlinks(repoDir: string): ExternalSymlink[] {
  const results: ExternalSymlink[] = [];
  for (const skillsDir of EXTERNAL_SKILL_DIRS) {
    if (!existsSync(skillsDir)) continue;
    for (const entry of readdirSync(skillsDir)) {
      const fullPath = join(skillsDir, entry);
      try {
        const stat = lstatSync(fullPath);
        if (!stat.isSymbolicLink()) continue;
        const target = readlinkSync(fullPath);
        if (!target.startsWith(repoDir)) {
          results.push({ path: fullPath, target });
        }
      } catch {
        // Entry disappeared or unreadable; skip.
      }
    }
  }
  return results;
}

/** Remove external symlinks temporarily, returning them for later restore. */
export function removeExternalSymlinks(
  links: readonly ExternalSymlink[],
): void {
  for (const link of links) {
    try {
      unlinkSync(link.path);
    } catch {
      // Already gone; fine.
    }
  }
}

/** Restore previously removed external symlinks. */
export function restoreExternalSymlinks(
  links: readonly ExternalSymlink[],
): void {
  for (const link of links) {
    try {
      if (!existsSync(link.path)) {
        symlinkSync(link.target, link.path);
      }
    } catch {
      // Best effort; stow result is the authoritative failure signal.
    }
  }
}

/** A stow package source file and the home path it maps to. */
interface StowTargetPair {
  readonly source: string;
  readonly target: string;
}

/** List source/target pairs that a stow package would manage. */
function listStowTargetPairs(
  packageRoot: string,
  folder: string,
): StowTargetPair[] {
  const pairs: StowTargetPair[] = [];
  collectStowTargetPairs(packageRoot, packageRoot, folder, pairs);
  return pairs;
}

/** Recursively collect file-like stow package entries as source/target pairs. */
function collectStowTargetPairs(
  packageRoot: string,
  currentDir: string,
  folder: string,
  pairs: StowTargetPair[],
): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (folder === "agents" && AGENTS_PRIVATE_IGNORED_ENTRIES.has(entry.name)) {
      continue;
    }

    const source = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectStowTargetPairs(packageRoot, source, folder, pairs);
      continue;
    }

    pairs.push({
      source,
      target: join(HOME_DIR, relative(packageRoot, source)),
    });
  }
}
