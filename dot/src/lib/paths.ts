import { join } from "path";

/** Current user's home directory path used by dot. */
export const HOME_DIR = process.env.HOME ?? `/home/${process.env.USER ?? ""}`;

/** XDG config directory path used by dot. */
export const CONFIG_DIR =
  process.env.XDG_CONFIG_HOME ?? join(HOME_DIR, ".config");

/** XDG cache directory path used by dot. */
export const CACHE_DIR = process.env.XDG_CACHE_HOME ?? join(HOME_DIR, ".cache");

/** XDG state directory path used by dot. */
export const STATE_DIR =
  process.env.XDG_STATE_HOME ?? join(HOME_DIR, ".local", "state");

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
