const HOME = process.env.HOME ?? `/home/${process.env.USER ?? ""}`;

/** Return the current user's home directory path used by dot. */
export function homeDir(): string {
  return HOME;
}

/** Expand a leading `~` segment to the current user's home directory. */
export function expandHomePath(path: string): string {
  return path.replace(/^~(?=\/|$)/, HOME);
}

/** Display an absolute path relative to the current user's home directory. */
export function displayPath(path: string): string {
  if (path === HOME) return "~";
  return path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
}
