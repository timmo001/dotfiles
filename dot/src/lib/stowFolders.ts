import { readdirSync, statSync } from "fs";
import { join } from "path";
import { ConfigService } from "../services/Config.js";
import { resolvedOmarchyHost } from "./omarchyHost.js";

/** Top-level repo directories that are not active stow packages. */
export const INTERNAL_STOW_FOLDERS = ["dot", "dot-migration", "docs"] as const;

const INTERNAL_FOLDERS = new Set<string>(INTERNAL_STOW_FOLDERS);

/**
 * Home-relative target directories that must stay real directories instead of
 * collapsing to a single folded symlink. Any stow package that lays a file
 * into one of these directories requires `--no-folding`, because external
 * tools, omarchy, or `systemctl` write their own files into the same directory
 * and folding would make it the repo directory (so those writes would land
 * inside the dotfiles repo).
 *
 * - `.agents/skills`: external skill symlinks live alongside the stowed skills.
 * - `.config/fish/completions`: fish and other tools write generated
 *   completions (and fish writes `fish_variables`, `functions/`, `conf.d/`).
 * - `.config/hypr`: the runtime `~/.config/hypr/host` symlink, omarchy shaders,
 *   and `~/.local/state` toggles live alongside the stowed config.
 * - `.config/nvim`: `omarchy-nvim-setup` owns `~/.config/nvim` and writes into
 *   it (the `lua/plugins/theme.lua` symlink and its default plugin files).
 * - `.config/systemd/user`: omarchy ships units here and `systemctl --user
 *   enable` writes `*.target.wants/` symlinks and drop-in directories.
 * - `.local/bin`: mise, npm, pip, cargo, and other tools install binaries here
 *   alongside the stowed scripts.
 * - `.local/share/applications`: desktop entries are installed here by apps and
 *   the system alongside the stowed `.desktop` files.
 * - `.local/share/bash-completion/completions` and
 *   `.local/share/zsh/site-functions`: tool-generated shell completions (e.g.
 *   `_copilot` from the Copilot CLI) are written here.
 */
const NO_FOLDING_TARGET_PREFIXES = [
  ".agents/skills",
  ".config/fish/completions",
  ".config/hypr",
  ".config/nvim",
  ".config/systemd/user",
  ".local/bin",
  ".local/share/applications",
  ".local/share/bash-completion/completions",
  ".local/share/zsh/site-functions",
] as const;

/**
 * Whether a stow package must be laid down with `--no-folding`.
 *
 * Detects by target path rather than package name: a package requires
 * `--no-folding` when it contains any {@link NO_FOLDING_TARGET_PREFIXES}
 * directory. This auto-covers host variants (`scripts--laptop`) and private
 * packages that share the same target directories, with no per-name upkeep.
 *
 * @param repoDir - Absolute path to the stow repo root.
 * @param folder - Stow package directory name within `repoDir`.
 */
export function requiresNoFolding(repoDir: string, folder: string): boolean {
  const packageDir = join(repoDir, folder);
  return NO_FOLDING_TARGET_PREFIXES.some((prefix) => {
    try {
      statSync(join(packageDir, prefix));
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * List top-level stow package directories in a repo.
 *
 * Filters out non-directory entries, dotfiles, internal folders, the backup
 * folder, and host-specific packages that don't match `OMARCHY_HOST`.
 */
export function listStowFolders(
  repoDir: string,
  config?: ConfigService,
): string[] {
  const host = config ? (resolvedOmarchyHost(config) ?? "") : "";
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
