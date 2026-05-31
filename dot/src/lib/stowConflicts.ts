import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import { basename, dirname, join, relative } from "path";
import { listStowFolders } from "./stowFolders.js";

const HOME = process.env.HOME ?? "/home/" + process.env.USER;
const EXTERNAL_SKILL_DIRS = [
  join(HOME, ".agents", "skills"),
  join(HOME, ".claude", "skills"),
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
    for (const target of listStowTargets(packageRoot, folder)) {
      backupFileIfUnmanaged(
        target,
        join(backupRoot, dirname(relative(HOME, target))),
      );
    }
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

/** List target paths that a stow package would manage. */
function listStowTargets(packageRoot: string, folder: string): string[] {
  const targets: string[] = [];
  collectStowTargets(packageRoot, packageRoot, folder, targets);
  return targets;
}

/** Recursively collect file-like stow package entries as home-relative targets. */
function collectStowTargets(
  packageRoot: string,
  currentDir: string,
  folder: string,
  targets: string[],
): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (folder === "agents" && AGENTS_PRIVATE_IGNORED_ENTRIES.has(entry.name)) {
      continue;
    }

    const source = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectStowTargets(packageRoot, source, folder, targets);
      continue;
    }

    targets.push(join(HOME, relative(packageRoot, source)));
  }
}
