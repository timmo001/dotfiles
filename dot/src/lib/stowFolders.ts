import { Effect, FileSystem } from "effect";
import { join } from "path";
import { Config, type ConfigService } from "../services/Config.js";
import { resolvedOmarchyHost } from "./omarchyHost.js";
import { readPrivateSelection } from "./privateSelection.js";

/** Top-level repo directories that are not active stow packages. */
export const INTERNAL_STOW_FOLDERS = [
  "avahi",
  "btrfs-balance",
  "chromium-extension",
  "dot",
  "dot-migration",
  "docs",
  "first-party",
  "lan-direct",
  "macropad",
  "node_modules",
  "tests",
  "udev-rules",
] as const;

const INTERNAL_FOLDERS = new Set<string>(INTERNAL_STOW_FOLDERS);

/**
 * Packages only the Omarchy desktop uses, which Station never stows. They stay
 * in the tree rather than being deleted, so merges from the desktop branch
 * don't conflict whenever they change there.
 *
 * - `hypr`, `omarchy`, `omarchy-themes` and `uwsm`: the Omarchy session.
 * - `herdr-app`: the Herdr app, which Station leaves out since it only comes
 *   as an AUR build.
 * - `hokum`: the desktop's notification and card app.
 * - `pacman-hooks`: the Omarchy patch hook and Nautilus's file manager hook,
 *   which `dot init` would otherwise install system-wide.
 * - `plannotator`, `cursor` and `nix`: desktop-only tools.
 */
const DESKTOP_ONLY_STOW_FOLDERS = new Set<string>([
  "cursor",
  "herdr-app",
  "hokum",
  "hypr",
  "nix",
  "omarchy",
  "omarchy-themes",
  "pacman-hooks",
  "plannotator",
  "uwsm",
]);

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
 * - `.config/ghostty`: host overrides and any Ghostty-generated files live
 *   alongside the stowed config.
 * - `.config/herdr`: Herdr writes logs, sockets, and session state alongside
 *   its stowed config.
 * - `.config/herdr-app`: the Herdr app writes its shipped layouts, mods,
 *   type files, socket and window state alongside the stowed keys, settings,
 *   themes and `dot-*` mods.
 * - `.config/hypr`: the runtime `~/.config/hypr/host` symlink, omarchy shaders,
 *   and `~/.local/state` toggles live alongside the stowed config.
 * - `.config/opencode`: the public and private `agents` packages both stow into
 *   it, and OpenCode writes its own files there. On a machine without it yet,
 *   folding would make it one link into the public repo, which the private
 *   package can't stow into.
 * - `.config/nvim`: `omarchy-nvim-setup` owns `~/.config/nvim` and writes into
 *   it (the `lua/plugins/theme.lua` symlink and its default plugin files).
 * - `.config/omarchy/plugins`: public and private user plugins share this
 *   directory, and Omarchy may manage additional plugins alongside them.
 * - `.config/pacman-hooks`: public and private pacman hooks share this
 *   directory.
 * - `.config/uwsm`: UWSM and Omarchy may add package or migration-owned files
 *   alongside the stowed user environment override.
 * - `.config/systemd/user`: omarchy ships units here and `systemctl --user
 *   enable` writes `*.target.wants/` symlinks and drop-in directories.
 * - `.local/bin`: mise, npm, pip, cargo, and other tools install binaries here
 *   alongside the stowed scripts.
 * - `.local/share/applications`: desktop entries are installed here by apps and
 *   the system alongside the stowed `.desktop` files.
 * - `.local/share/bash-completion/completions` and
 *   `.local/share/zsh/site-functions`: tool-generated shell completions (e.g.
 *   `_copilot` from the Copilot CLI) are written here.
 * - `.pi/agent`: Pi writes sessions and auth here, and the public `pi` and
 *   private `agents` packages both stow into it.
 * - `.plannotator`: Plannotator keeps the Inbox, plans and reviews here
 *   alongside the stowed `config.json`.
 */
const NO_FOLDING_TARGET_PREFIXES = [
  ".agents/skills",
  ".pi/agent",
  ".plannotator",
  ".config/fish/completions",
  ".config/ghostty",
  ".config/herdr",
  ".config/herdr-app",
  ".config/hypr",
  ".config/nvim",
  ".config/opencode",
  ".config/omarchy/plugins",
  ".config/pacman-hooks",
  ".config/uwsm",
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
export const requiresNoFolding = Effect.fn("StowFolders.requiresNoFolding")(
  function* (repoDir: string, folder: string) {
    const fs = yield* FileSystem.FileSystem;
    const packageDir = join(repoDir, folder);

    for (const prefix of NO_FOLDING_TARGET_PREFIXES) {
      const found = yield* fs.stat(join(packageDir, prefix)).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );

      if (found) return true;
    }

    return false;
  },
);

/**
 * List top-level stow package directories in a repo.
 *
 * Filters out non-directory entries, dotfiles, internal folders, desktop-only
 * packages, the backup folder, and host-specific packages that don't match
 * `OMARCHY_HOST`.
 */
export const listStowFolders = Effect.fn("StowFolders.listStowFolders")(
  function* (repoDir: string, config?: ConfigService) {
    const fs = yield* FileSystem.FileSystem;
    const host = config ? ((yield* resolvedOmarchyHost(config)) ?? "") : "";
    const entries = yield* fs.readDirectory(repoDir).pipe(Effect.orDie);
    const folders: string[] = [];

    for (const entry of entries) {
      const isDirectory = yield* fs.stat(join(repoDir, entry)).pipe(
        Effect.map((info) => info.type === "Directory"),
        Effect.orElseSucceed(() => false),
      );

      if (!isDirectory) continue;

      // Skip backup folder (only used during install)
      if (entry === "backup") continue;

      // Skip repo internals that are not stow packages.
      if (INTERNAL_FOLDERS.has(entry)) continue;

      if (DESKTOP_ONLY_STOW_FOLDERS.has(entry)) continue;

      // Skip dot-internal directories that aren't stow packages
      if (entry.startsWith(".")) continue;

      // Host-specific packages use double-dash: <name>--<host>
      if (entry.includes("--")) {
        const hostSuffix = entry.slice(entry.lastIndexOf("--") + 2);

        if (hostSuffix !== host) continue;
      }

      folders.push(entry);
    }

    return folders;
  },
);

/**
 * List the stow packages dot links from a repository: every package in the
 * public repository, and only those selected in `.dot-private.yml` in the
 * private one.
 */
export const selectedStowFolders = Effect.fn("StowFolders.selected")(function* (
  repoDir: string,
) {
  const config = yield* Config;
  const folders = yield* listStowFolders(repoDir, config);

  if (repoDir !== config.privateDotfiles) return folders;

  const selection =
    (yield* readPrivateSelection(config.publicDotfiles))?.stow ?? null;

  return selection === null
    ? folders
    : folders.filter((folder) => selection.has(folder));
});
