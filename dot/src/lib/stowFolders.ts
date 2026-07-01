import { readdirSync, statSync } from "fs";
import { join } from "path";
import { ENV, envString } from "./env.js";

/** Top-level repo directories that are not active stow packages. */
export const INTERNAL_STOW_FOLDERS = ["dot", "dot-migration", "docs"] as const;

const INTERNAL_FOLDERS = new Set<string>(INTERNAL_STOW_FOLDERS);

/**
 * Stow packages that must be laid down with `--no-folding` so their target
 * directories stay real directories instead of collapsing to a single folded
 * symlink.
 *
 * - `agents`: `~/.local/state` toggles and external skill symlinks live
 *   alongside the stowed skills.
 * - `hypr`: the runtime `~/.config/hypr/host` symlink, omarchy shaders, and
 *   `~/.local/state` toggles live alongside the stowed config.
 * - `neovim`: `omarchy-nvim-setup` owns `~/.config/nvim` and writes into it
 *   (the `lua/plugins/theme.lua` symlink and its default plugin files);
 *   folding would make that the repo directory, so omarchy would write inside
 *   the repo.
 * - `zsh`: tool-generated completions (e.g. `_copilot` from the Copilot CLI)
 *   are written into `~/.local/share/zsh/site-functions/`; folding would make
 *   that the repo directory, so external tools would write inside the repo.
 */
const NO_FOLDING_STOW_FOLDERS = new Set<string>([
  "agents",
  "hypr",
  "neovim",
  "zsh",
]);

/** Whether a stow package must be laid down with `--no-folding`. */
export function requiresNoFolding(folder: string): boolean {
  return NO_FOLDING_STOW_FOLDERS.has(folder);
}

/**
 * List top-level stow package directories in a repo.
 *
 * Filters out non-directory entries, dotfiles, internal folders, the backup
 * folder, and host-specific packages that don't match `OMARCHY_HOST`.
 */
export function listStowFolders(repoDir: string): string[] {
  const host = envString(ENV.OMARCHY_HOST) ?? "";
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
