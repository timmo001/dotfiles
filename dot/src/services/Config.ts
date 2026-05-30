import { Context, Effect, Layer } from "effect";
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { basename, join } from "path";

const HOME = process.env.HOME ?? "/home/" + process.env.USER;

function expandHomePath(path: string): string {
  return path.replace(/^~(?=\/|$)/, HOME);
}

/** Omarchy repo configuration for diff tracking */
export interface OmarchyRepoConfig {
  /** Base directory for omarchy repos (default: ~/.config) */
  readonly repoBase: string;
  /** Repos to include in diff (e.g. ["hypr", "waybar", "bootstrap"]) */
  readonly diffRepos: readonly string[];
  /** Repos with multiple worktree branches (e.g. ["hypr"]) */
  readonly worktreeRepos: readonly string[];
  /** Branch names for worktrees (e.g. ["desktop", "laptop"]) */
  readonly worktreeBranches: readonly string[];
  /** Whether omarchy diff repos are enabled */
  readonly enabled: boolean;
}

/** Extra repository entry loaded from the private config file */
export interface ExtraRepo {
  /** Short display name */
  readonly name: string;
  /** Absolute filesystem path */
  readonly path: string;
  /** Schedule constraint (empty string means always visible) */
  readonly schedule: string;
}

/** Service interface providing resolved paths and environment detection */
export interface ConfigService {
  /** Path to the public dotfiles repository */
  readonly publicDotfiles: string;
  /** Path to the private dotfiles repository (null if not available) */
  readonly privateDotfiles: string | null;
  /** Whether private dotfiles are available and accessible */
  readonly canUsePrivate: boolean;
  /** Reason shown for private availability status */
  readonly privateReason: string;
  /** Path to the notes repository */
  readonly notesDir: string;
  /** Omarchy repository configuration */
  readonly omarchy: OmarchyRepoConfig;
  /** Extra repos loaded from private config file */
  readonly extraRepos: readonly ExtraRepo[];
  /** XDG cache directory for dot */
  readonly cacheDir: string;
  /** XDG state directory for dot */
  readonly stateDir: string;
  /** Log directory under stateDir */
  readonly logDir: string;
}

/** Load extra repos from the pipe-delimited config file */
function loadExtraRepos(filePath: string): readonly ExtraRepo[] {
  try {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    const repos: ExtraRepo[] = [];

    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      if (line.includes("|")) {
        const [name, path, schedule] = line.split("|", 3);
        const trimmedPath = (path ?? "").trim().replace(/^~/, HOME);
        const trimmedName = (name ?? "").trim() || basename(trimmedPath);
        if (!trimmedPath) continue;
        repos.push({
          name: trimmedName,
          path: trimmedPath,
          schedule: (schedule ?? "").trim(),
        });
      } else {
        const repoPath = line.replace(/^~/, HOME);
        repos.push({ name: basename(repoPath), path: repoPath, schedule: "" });
      }
    }

    return repos;
  } catch {
    return [];
  }
}

/** Effect service for {@link ConfigService} */
export class Config extends Context.Service<Config, ConfigService>()("Config") {
  static readonly layer = Layer.effect(
    Config,
    Effect.sync(() => {
      const publicDotfiles = join(HOME, ".config", "dotfiles");

      const privatePath = join(HOME, ".config", "dotfiles-private");
      const privateExists = existsSync(join(privatePath, ".git"));
      let canUsePrivate = false;
      let privateReason: string;

      if (process.env.DOT_ALLOW_PRIVATE === "never") {
        privateReason = "DOT_ALLOW_PRIVATE=never";
      } else if (process.env.DOT_ALLOW_PRIVATE === "always") {
        canUsePrivate = true;
        privateReason = "DOT_ALLOW_PRIVATE=always";
      } else if (!privateExists) {
        privateReason = `private repo not present (${privatePath})`;
      } else {
        try {
          const stat = statSync(privatePath);
          const uid = process.getuid?.();
          if (uid !== undefined && stat.uid !== uid) {
            privateReason = `private repo not owned by current user (${privatePath})`;
          } else {
            canUsePrivate = true;
            privateReason = "private repo access granted";
          }
        } catch {
          privateReason = `private repo not accessible (${privatePath})`;
        }
      }

      const privateDotfiles = canUsePrivate ? privatePath : null;

      const notesDir = expandHomePath(
        process.env.NOTES ||
          process.env.DOT_NOTES_DIR ||
          join(HOME, "Documents", "notes"),
      );

      // Omarchy config
      const omarchyRepoBase =
        process.env.OMARCHY_REPO_BASE_DIR ?? join(HOME, ".config");
      const omarchyDiffRepos = [
        "hypr",
        "waybar",
        "bootstrap",
        "ghostty",
        "uwsm",
      ];
      const omarchyWorktreeRepos = ["hypr"];
      const omarchyWorktreeBranches = ["desktop", "laptop"];
      const omarchyEnabled =
        (process.env.DOT_INCLUDE_OMARCHY_DIFF_REPOS ?? "1") !== "0";

      const omarchy: OmarchyRepoConfig = {
        repoBase: omarchyRepoBase,
        diffRepos: omarchyDiffRepos,
        worktreeRepos: omarchyWorktreeRepos,
        worktreeBranches: omarchyWorktreeBranches,
        enabled: omarchyEnabled,
      };

      // Extra repos from private config
      const extraReposFile =
        process.env.DOT_PRIVATE_EXTRA_REPOS_FILE ??
        join(privatePath, ".dot-extra-repos");
      const extraRepos = canUsePrivate ? loadExtraRepos(extraReposFile) : [];

      const xdgCache = process.env.XDG_CACHE_HOME ?? join(HOME, ".cache");
      const xdgState =
        process.env.XDG_STATE_HOME ?? join(HOME, ".local", "state");

      const cacheDir = join(xdgCache, "dot");
      const stateDir = join(xdgState, "dot");
      const logDir = join(stateDir, "logs");

      // Ensure directories exist
      mkdirSync(cacheDir, { recursive: true });
      mkdirSync(logDir, { recursive: true });

      return {
        publicDotfiles,
        privateDotfiles,
        canUsePrivate,
        privateReason,
        notesDir,
        omarchy,
        extraRepos,
        cacheDir,
        stateDir,
        logDir,
      };
    }),
  );
}
