import { Context, Effect, Layer } from "effect";
import { existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";
import {
  defaultDotGitConfigPath,
  emptyDotGitConfig,
  loadDotGitConfig,
  type DotGitConfig,
} from "./GitConfig.js";
import {
  defaultMcpConfigPath,
  emptyMcpConfig,
  loadMcpConfig,
  type DotMcpConfig,
} from "../mcp/sync/loadSpec.js";
import {
  CACHE_DIR,
  CONFIG_DIR,
  HOME_DIR,
  STATE_DIR,
  expandHomePath,
} from "../lib/paths.js";
import { ENV, envString } from "../lib/env.js";

/** Omarchy repo configuration for diff tracking */
export interface OmarchyRepoConfig {
  /** Base directory for omarchy repos (default: ~/.config) */
  readonly repoBase: string;
  /** Repos to include in diff (e.g. ["waybar", "uwsm"]) */
  readonly diffRepos: readonly string[];
  /** Repos with multiple worktree branches */
  readonly worktreeRepos: readonly string[];
  /** Branch names for worktrees */
  readonly worktreeBranches: readonly string[];
  /** Expected branch for each Omarchy diff repo */
  readonly expectedBranches: Readonly<Record<string, string>>;
  /** Whether omarchy diff repos are enabled */
  readonly enabled: boolean;
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
  /** Private git repository and workflow configuration. */
  readonly gitConfig: DotGitConfig;
  /** Private MCP server sync configuration. */
  readonly mcpConfig: DotMcpConfig;
  /** XDG cache directory for dot */
  readonly cacheDir: string;
  /** XDG state directory for dot */
  readonly stateDir: string;
  /** Log directory under stateDir */
  readonly logDir: string;
}

/** Effect service for {@link ConfigService} */
export class Config extends Context.Service<Config, ConfigService>()("Config") {
  static readonly layer = Layer.effect(
    Config,
    Effect.sync(() => {
      const publicDotfiles = expandHomePath(
        envString(ENV.DOTFILES_PUBLIC_DIR) ?? join(CONFIG_DIR, "dotfiles"),
      );

      const privatePath = expandHomePath(
        envString(ENV.DOTFILES_PRIVATE_DIR) ??
          join(CONFIG_DIR, "dotfiles-private"),
      );
      const privateExists = existsSync(join(privatePath, ".git"));
      let canUsePrivate = false;
      let privateReason: string;

      if (envString(ENV.DOT_ALLOW_PRIVATE) === "never") {
        privateReason = "DOT_ALLOW_PRIVATE=never";
      } else if (envString(ENV.DOT_ALLOW_PRIVATE) === "always") {
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
        envString(ENV.NOTES) ||
          envString(ENV.DOT_NOTES_DIR) ||
          join(HOME_DIR, "Documents", "notes"),
      );

      // Omarchy config
      const omarchyRepoBase =
        envString(ENV.OMARCHY_REPO_BASE_DIR) ?? CONFIG_DIR;
      const omarchyDiffRepos = ["waybar", "uwsm"];
      const omarchyWorktreeRepos: readonly string[] = [];
      const omarchyWorktreeBranches = ["desktop", "laptop"];
      const omarchyExpectedBranches = {
        waybar: "main",
        uwsm: "main",
      } satisfies Readonly<Record<string, string>>;
      const omarchyEnabled =
        (envString(ENV.DOT_INCLUDE_OMARCHY_DIFF_REPOS) ?? "1") !== "0";

      const omarchy: OmarchyRepoConfig = {
        repoBase: omarchyRepoBase,
        diffRepos: omarchyDiffRepos,
        worktreeRepos: omarchyWorktreeRepos,
        worktreeBranches: omarchyWorktreeBranches,
        expectedBranches: omarchyExpectedBranches,
        enabled: omarchyEnabled,
      };

      const gitConfigFile =
        envString(ENV.DOT_GIT_CONFIG_FILE) ??
        defaultDotGitConfigPath(privatePath);
      const gitConfig = canUsePrivate
        ? loadDotGitConfig(gitConfigFile)
        : emptyDotGitConfig(gitConfigFile);

      const mcpConfigFile =
        envString(ENV.DOT_MCP_CONFIG_FILE) ?? defaultMcpConfigPath(privatePath);
      const mcpConfig = canUsePrivate
        ? loadMcpConfig(mcpConfigFile)
        : emptyMcpConfig(mcpConfigFile);

      const cacheDir = join(CACHE_DIR, "dot");
      const stateDir = join(STATE_DIR, "dot");
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
        gitConfig,
        mcpConfig,
        cacheDir,
        stateDir,
        logDir,
      };
    }),
  );
}
