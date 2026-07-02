/** Environment variable names used by dot. */
export const ENV = {
  CLAUDECODE: "CLAUDECODE",
  CODEX_THREAD_ID: "CODEX_THREAD_ID",
  DOT_AGENT: "DOT_AGENT",
  DOT_AGENTS_SYNC_RULE_FILE: "DOT_AGENTS_SYNC_RULE_FILE",
  DOT_AGENTS_SYNC_SOURCE: "DOT_AGENTS_SYNC_SOURCE",
  DOT_ALLOW_PRIVATE: "DOT_ALLOW_PRIVATE",
  DOT_BOOTSTRAP_BRANCH: "DOT_BOOTSTRAP_BRANCH",
  DOT_DEBUG: "DOT_DEBUG",
  DOT_FETCH_TTL_SECONDS: "DOT_FETCH_TTL_SECONDS",
  DOT_GH_EXTENSIONS_FILE: "DOT_GH_EXTENSIONS_FILE",
  DOT_GIT_CONFIG_FILE: "DOT_GIT_CONFIG_FILE",
  DOT_GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS:
    "DOT_GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS",
  DOT_GITHUB_RATE_LIMIT_MIN_REMAINING: "DOT_GITHUB_RATE_LIMIT_MIN_REMAINING",
  DOT_GITHUB_RATE_LIMIT_TTL_SECONDS: "DOT_GITHUB_RATE_LIMIT_TTL_SECONDS",
  DOT_GITHUB_RETRIES: "DOT_GITHUB_RETRIES",
  DOT_INCLUDE_OMARCHY_DIFF_REPOS: "DOT_INCLUDE_OMARCHY_DIFF_REPOS",
  DOT_INIT_LOG_FILE: "DOT_INIT_LOG_FILE",
  DOT_INIT_NONINTERACTIVE: "DOT_INIT_NONINTERACTIVE",
  DOT_LOG_FILE: "DOT_LOG_FILE",
  DOT_LOG_MIRROR_FILE: "DOT_LOG_MIRROR_FILE",
  DOT_NOTES_DIR: "DOT_NOTES_DIR",
  DOT_OMARCHY_BRANCH: "DOT_OMARCHY_BRANCH",
  DOT_PRIVATE_BROWSER_CHECKS_FILE: "DOT_PRIVATE_BROWSER_CHECKS_FILE",
  DOT_PRIVATE_PACKAGE_MAP_FILE: "DOT_PRIVATE_PACKAGE_MAP_FILE",
  DOT_PRIVATE_PACKAGE_REPO_FILE: "DOT_PRIVATE_PACKAGE_REPO_FILE",
  DOT_PRIVATE_PACKAGES_FILE: "DOT_PRIVATE_PACKAGES_FILE",
  DOT_PRIVATE_PACMAN_MAIN_CONFIG: "DOT_PRIVATE_PACMAN_MAIN_CONFIG",
  DOT_PRIVATE_PACMAN_REPO_CONFIG: "DOT_PRIVATE_PACMAN_REPO_CONFIG",
  DOT_PUBLIC_PACKAGES_FILE: "DOT_PUBLIC_PACKAGES_FILE",
  DOT_TEE_INHERIT_LOG: "DOT_TEE_INHERIT_LOG",
  DOT_UFW_RULES_FILE: "DOT_UFW_RULES_FILE",
  DOTFILES_PRIVATE_DIR: "DOTFILES_PRIVATE_DIR",
  DOTFILES_PUBLIC_DIR: "DOTFILES_PUBLIC_DIR",
  EDITOR: "EDITOR",
  HOME: "HOME",
  LIBVA_DRIVER_NAME: "LIBVA_DRIVER_NAME",
  MISE_GLOBAL_CONFIG_FILE: "MISE_GLOBAL_CONFIG_FILE",
  NOTES: "NOTES",
  OMARCHY_HOST: "OMARCHY_HOST",
  OMARCHY_REPO_BASE_DIR: "OMARCHY_REPO_BASE_DIR",
  OPENCODE: "OPENCODE",
  OPENCODE_APP_INFO: "OPENCODE_APP_INFO",
  OPENCODE_BIN_PATH: "OPENCODE_BIN_PATH",
  OPENCODE_MODES: "OPENCODE_MODES",
  OPENCODE_SERVER: "OPENCODE_SERVER",
  TMPDIR: "TMPDIR",
  USER: "USER",
  VISUAL: "VISUAL",
  XDG_CACHE_HOME: "XDG_CACHE_HOME",
  XDG_CONFIG_HOME: "XDG_CONFIG_HOME",
  XDG_STATE_HOME: "XDG_STATE_HOME",
} as const;

/** Dot environment variable name. */
export type EnvName = (typeof ENV)[keyof typeof ENV];

/** Read an environment variable as a string. */
export function envString(name: EnvName): string | undefined {
  return process.env[name];
}

/** Read an environment variable as a string with a fallback. */
export function envStringOr(name: EnvName, fallback: string): string {
  return envString(name) ?? fallback;
}

/** Read a `1`-enabled environment flag. */
export function envFlag(name: EnvName): boolean {
  return envString(name) === "1";
}

/** Read an integer environment variable with a fallback. */
export function envInt(name: EnvName, fallback: number): number {
  const value = envString(name);
  const parsed = value === undefined ? NaN : parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read a non-negative integer environment variable with a fallback. */
export function envNonNegativeInt(name: EnvName, fallback: number): number {
  const parsed = envInt(name, fallback);
  return parsed >= 0 ? parsed : fallback;
}

/** Set an environment variable. */
export function setEnv(name: EnvName, value: string): void {
  process.env[name] = value;
}

/** Remove an environment variable. */
export function unsetEnv(name: EnvName): void {
  delete process.env[name];
}
