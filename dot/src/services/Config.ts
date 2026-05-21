import { Context, Effect, Layer } from "effect";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME ?? "/home/" + process.env.USER;

/** Service interface providing resolved paths and environment detection */
export interface ConfigService {
  /** Path to the public dotfiles repository */
  readonly publicDotfiles: string;
  /** Path to the private dotfiles repository (null if not available) */
  readonly privateDotfiles: string | null;
  /** Whether private dotfiles are available and accessible */
  readonly canUsePrivate: boolean;
  /** XDG cache directory for dot */
  readonly cacheDir: string;
  /** XDG state directory for dot */
  readonly stateDir: string;
  /** Log directory under stateDir */
  readonly logDir: string;
}

/** Effect service for {@link ConfigService} */
export class Config extends Context.Service<Config, ConfigService>()(
  "Config",
) {
  static readonly layer = Layer.effect(
    Config,
    Effect.sync(() => {
      const publicDotfiles = join(HOME, ".config", "dotfiles");

      const privatePath = join(HOME, ".config", "dotfiles-private");
      const canUsePrivate = existsSync(join(privatePath, ".git"));
      const privateDotfiles = canUsePrivate ? privatePath : null;

      const xdgCache = process.env.XDG_CACHE_HOME ?? join(HOME, ".cache");
      const xdgState = process.env.XDG_STATE_HOME ?? join(HOME, ".local", "state");

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
        cacheDir,
        stateDir,
        logDir,
      };
    }),
  );
}
