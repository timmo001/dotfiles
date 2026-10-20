import { Effect, FileSystem, Schema } from "effect";
import { hostname } from "node:os";
import { join } from "path";
import { Config } from "../services/Config.js";
import { readTextOrNull } from "./fsProbe.js";

/** Top-level repo directories that are not active stow packages. */
export const INTERNAL_STOW_FOLDERS = [
  "dot",
  "dot-migration",
  "docs",
  "node_modules",
  "tests",
] as const;

const INTERNAL_FOLDERS = new Set<string>(INTERNAL_STOW_FOLDERS);

/**
 * Home-relative target directories that must stay real directories instead of
 * collapsing to a single folded symlink. Any stow package that lays a file
 * into one of these directories requires `--no-folding`, because external
 * tools or `systemctl` write their own files into the same directory
 * and folding would make it the repo directory (so those writes would land
 * inside the dotfiles repo).
 *
 * - `.agents/skills`: external skill symlinks live alongside the stowed skills.
 * - `.config/fish/completions`: fish and other tools write generated
 *   completions (and fish writes `fish_variables`, `functions/`, `conf.d/`).
 * - `.config/herdr`: Herdr writes logs, sockets, and session state alongside
 *   its stowed config.
 * - `.config/nvim`: lazy.nvim and plugins write into the config directory.
 * - `.config/systemd/user`: `systemctl --user enable` writes
 *   `*.target.wants/` symlinks and drop-in directories.
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
  ".config/herdr",
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
 * Filters out non-directory entries, dotfiles, internal folders, the backup
 * folder, and host-specific packages that don't match the machine's hostname.
 */
export const listStowFolders = Effect.fn("StowFolders.listStowFolders")(
  function* (repoDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const host = hostname();
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

/** `.dot-private.yml`: the private stow packages this machine pulls in. */
const PrivateSelection = Schema.Struct({ stow: Schema.Array(Schema.String) });

/**
 * Private stow packages listed under `stow` in the public `.dot-private.yml`,
 * or `null` to stow them all when the file is missing. An invalid file
 * selects none, so a typo never stows the desktop's packages.
 */
export const privateStowSelection = Effect.fn("StowFolders.privateSelection")(
  function* (publicDotfiles: string) {
    const text = yield* readTextOrNull(
      join(publicDotfiles, ".dot-private.yml"),
    );

    if (text === null) return null;

    return yield* Effect.try(() => Bun.YAML.parse(text)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(PrivateSelection)),
      Effect.map(({ stow }): ReadonlySet<string> => new Set(stow)),
      Effect.orElseSucceed((): ReadonlySet<string> => new Set()),
    );
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
  const folders = yield* listStowFolders(repoDir);

  if (repoDir !== config.privateDotfiles) return folders;

  const selection = yield* privateStowSelection(config.publicDotfiles);

  return selection === null
    ? folders
    : folders.filter((folder) => selection.has(folder));
});
