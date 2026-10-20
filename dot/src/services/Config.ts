import { Context, Effect, FileSystem, Layer, Option } from "effect";
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
import { readPrivateSelection } from "../lib/privateSelection.js";

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
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const publicDotfiles = expandHomePath(
        envString(ENV.DOTFILES_PUBLIC_DIR) ?? join(CONFIG_DIR, "dotfiles"),
      );

      const privatePath = expandHomePath(
        envString(ENV.DOTFILES_PRIVATE_DIR) ??
          join(CONFIG_DIR, "dotfiles-private"),
      );

      const privateExists = yield* fs
        .exists(join(privatePath, ".git"))
        .pipe(Effect.orElseSucceed(() => false));

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
        const stat = yield* fs.stat(privatePath).pipe(Effect.option);
        const uid = process.getuid?.();

        if (Option.isNone(stat)) {
          privateReason = `private repo not accessible (${privatePath})`;
        } else if (
          uid !== undefined &&
          Option.getOrUndefined(stat.value.uid) !== uid
        ) {
          privateReason = `private repo not owned by current user (${privatePath})`;
        } else {
          canUsePrivate = true;
          privateReason = "private repo access granted";
        }
      }

      const privateDotfiles = canUsePrivate ? privatePath : null;

      const notesDir = expandHomePath(
        envString(ENV.NOTES) ||
          envString(ENV.DOT_NOTES_DIR) ||
          join(HOME_DIR, "Documents", "notes"),
      );

      const gitConfigFile =
        envString(ENV.DOT_GIT_CONFIG_FILE) ??
        defaultDotGitConfigPath(privatePath);

      const loadedGitConfig = canUsePrivate
        ? yield* loadDotGitConfig(gitConfigFile)
        : emptyDotGitConfig(gitConfigFile);

      const repoSelection = (yield* readPrivateSelection(publicDotfiles))
        ?.repos;

      const gitConfig: DotGitConfig =
        repoSelection === null || repoSelection === undefined
          ? loadedGitConfig
          : {
              ...loadedGitConfig,
              repositories: loadedGitConfig.repositories.filter(
                (repo) =>
                  repo.machines?.includes(repoSelection.machine) ?? false,
              ),
              shallowClones: repoSelection.shallow,
            };

      const mcpConfigFile =
        envString(ENV.DOT_MCP_CONFIG_FILE) ?? defaultMcpConfigPath(privatePath);

      const mcpConfig = canUsePrivate
        ? yield* loadMcpConfig(mcpConfigFile)
        : emptyMcpConfig(mcpConfigFile);

      const cacheDir = join(CACHE_DIR, "dot");
      const stateDir = join(STATE_DIR, "dot");
      const logDir = join(stateDir, "logs");

      yield* fs.makeDirectory(logDir, { recursive: true }).pipe(Effect.orDie);
      yield* fs.makeDirectory(cacheDir, { recursive: true }).pipe(Effect.orDie);

      return {
        publicDotfiles,
        privateDotfiles,
        canUsePrivate,
        privateReason,
        notesDir,
        gitConfig,
        mcpConfig,
        cacheDir,
        stateDir,
        logDir,
      };
    }),
  );
}
