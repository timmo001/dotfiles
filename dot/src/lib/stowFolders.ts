import { readdirSync, statSync } from "fs";
import { join } from "path";

const INTERNAL_FOLDERS = new Set(["dot", "dot-migration"]);

/**
 * List top-level stow package directories in a repo.
 *
 * Filters out non-directory entries, dotfiles, internal folders, the backup
 * folder, and host-specific packages that don't match `OMARCHY_HOST`.
 */
export function listStowFolders(repoDir: string): string[] {
  const host = process.env.OMARCHY_HOST ?? "";
  const entries = readdirSync(repoDir);

  return entries.filter((entry) => {
    const fullPath = join(repoDir, entry);
    try {
      if (!statSync(fullPath).isDirectory()) return false;
    } catch {
      return false;
    }

    // Skip backup folder (only used during install)
    if (entry === "backup") return false;

    // Skip repo internals that are not stow packages.
    if (INTERNAL_FOLDERS.has(entry)) return false;

    // Skip dot-internal directories that aren't stow packages
    if (entry.startsWith(".")) return false;

    // Host-specific packages use double-dash: <name>--<host>
    if (entry.includes("--")) {
      const hostSuffix = entry.split("--").pop()!;
      if (hostSuffix !== host) return false;
    }

    return true;
  });
}
