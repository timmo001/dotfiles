import { delimiter, join } from "path";
import { ENV, envString, setEnv } from "./env.js";

/** Current user's home directory path used by dot. */
export const HOME_DIR =
  envString(ENV.HOME) ?? `/home/${envString(ENV.USER) ?? ""}`;

/** XDG config directory path used by dot. */
export const CONFIG_DIR =
  envString(ENV.XDG_CONFIG_HOME) ?? join(HOME_DIR, ".config");

/** XDG cache directory path used by dot. */
export const CACHE_DIR =
  envString(ENV.XDG_CACHE_HOME) ?? join(HOME_DIR, ".cache");

/** XDG data directory path used by dot. */
export const DATA_DIR =
  envString(ENV.XDG_DATA_HOME) ?? join(HOME_DIR, ".local", "share");

/** XDG state directory path used by dot. */
export const STATE_DIR =
  envString(ENV.XDG_STATE_HOME) ?? join(HOME_DIR, ".local", "state");

/**
 * dot's own binary, for dot running itself: `~/.local/bin` may be missing
 * from PATH (plain SSH), or come after Graphviz's `/usr/bin/dot`.
 */
export const DOT_BIN = join(HOME_DIR, ".local", "bin", "dot");

/**
 * Put mise's shims and `~/.local/bin` first on this process's PATH when
 * either is missing, as the user services set it, so dot and its children
 * find `bun`, mise's tools and dot itself under plain SSH.
 */
export function ensureUserPath(): void {
  const entries = (envString(ENV.PATH) ?? "").split(delimiter).filter(Boolean);

  const missing = [
    join(DATA_DIR, "mise", "shims"),
    join(HOME_DIR, ".local", "bin"),
  ].filter((dir) => !entries.includes(dir));

  if (missing.length > 0)
    setEnv(ENV.PATH, [...missing, ...entries].join(delimiter));
}

/** Expand a leading `~` segment to the current user's home directory. */
export function expandHomePath(path: string): string {
  return path.replace(/^~(?=\/|$)/, HOME_DIR);
}

/** Display an absolute path relative to the current user's home directory. */
export function displayPath(path: string): string {
  if (path === HOME_DIR) return "~";

  return path.startsWith(`${HOME_DIR}/`)
    ? `~${path.slice(HOME_DIR.length)}`
    : path;
}
