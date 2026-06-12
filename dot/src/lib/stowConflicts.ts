import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import { basename, dirname, join, relative } from "path";
import { displayPath, HOME_DIR } from "./paths.js";
import { listStowFolders } from "./stowFolders.js";

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

/** Stored external symlink for save/restore around stow. */
export interface ExternalSymlink {
  readonly path: string;
  readonly target: string;
}

/** Move an unmanaged path to the repo backup folder, preserving symlinks. */
export function backupFileIfUnmanaged(source: string, backupDir: string): void {
  if (!existsSync(source)) return;

  try {
    if (lstatSync(source).isSymbolicLink()) return;
  } catch {
    return;
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
}

/** Backup unmanaged private targets before private stow owns them. */
export function backupPrivateStowTargets(privateDotfiles: string): void {
  const backupRoot = join(privateDotfiles, "backup");

  for (const folder of listStowFolders(privateDotfiles).sort()) {
    const packageRoot = join(privateDotfiles, folder);
    for (const { target } of listStowTargetPairs(packageRoot, folder)) {
      backupFileIfUnmanaged(
        target,
        join(backupRoot, dirname(relative(HOME_DIR, target))),
      );
    }
  }
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
): string[] {
  const backupRoot = join(publicDotfiles, "backup");
  const backedUp: string[] = [];

  for (const folder of listStowFolders(publicDotfiles).sort()) {
    const packageRoot = join(publicDotfiles, folder);
    for (const { source, target } of listStowTargetPairs(packageRoot, folder)) {
      if (!liveTargetConflicts(source, target)) continue;
      backupFileIfUnmanaged(
        target,
        join(backupRoot, dirname(relative(HOME_DIR, target))),
      );
      backedUp.push(displayPath(target));
    }
  }

  return backedUp;
}

/** True when the live target is a real file whose bytes differ from source. */
function liveTargetConflicts(source: string, target: string): boolean {
  let stat;
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
