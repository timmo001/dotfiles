import { Effect } from "effect";
import { existsSync } from "fs";
import { basename, dirname, join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { managedGitRepos } from "../services/GitConfig.js";
import { gitOutput, isGitRepo } from "./git.js";
import { HOME_DIR, displayPath } from "./paths.js";
import type { ConfigService } from "../services/Config.js";

/**
 * Git pathspecs used to list candidate mise config files in a tracked repo.
 *
 * A leading `*` matches across path separators in git's default pathspec, so
 * these catch both root-level and nested configs (e.g. `dot/mise.toml`). The
 * matches are re-checked against {@link isMiseConfigPath} to drop incidental
 * hits like `promise.toml`.
 */
const MISE_CONFIG_PATHSPECS = [
  "*mise.toml",
  "*mise.local.toml",
  "*mise/config.toml",
] as const;

/** Config file basenames mise treats as a config file. */
const MISE_CONFIG_BASENAMES: ReadonlySet<string> = new Set([
  "mise.toml",
  ".mise.toml",
  "mise.local.toml",
  ".mise.local.toml",
]);

/** Directory names that hold a `config.toml` mise config. */
const MISE_CONFIG_DIR_NAMES: ReadonlySet<string> = new Set(["mise", ".mise"]);

/** Whether a repo-relative path is a mise config file worth trusting. */
function isMiseConfigPath(relativePath: string): boolean {
  const base = basename(relativePath);
  if (MISE_CONFIG_BASENAMES.has(base)) return true;
  return (
    base === "config.toml" &&
    MISE_CONFIG_DIR_NAMES.has(basename(dirname(relativePath)))
  );
}

/**
 * Build the deduped set of repositories dot tracks, as absolute paths.
 *
 * Covers public dotfiles, private dotfiles, notes, the Omarchy diff repos, and
 * every repo declared in the private `dot-git.yml` (not schedule-gated). Only
 * existing git checkouts are returned; on a machine without private dotfiles
 * this degrades to the public dotfiles, notes, and Omarchy repos.
 */
function trackedRepoRoots(config: ConfigService): readonly string[] {
  const roots: string[] = [];
  const add = (path: string | null): void => {
    if (path) roots.push(path);
  };

  add(config.publicDotfiles);
  add(config.privateDotfiles);
  add(config.notesDir);
  if (config.omarchy.enabled) {
    for (const repoName of config.omarchy.diffRepos) {
      add(join(config.omarchy.repoBase, repoName));
    }
  }
  for (const repo of managedGitRepos(config.gitConfig)) {
    add(repo.path);
  }

  const seen = new Set<string>();
  return roots.filter((path) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return existsSync(path) && isGitRepo(path);
  });
}

/**
 * List committed mise config files in a repository as absolute paths.
 *
 * Uses `git ls-files` so the scan is fast on large repos and skips gitignored
 * trees (`node_modules`, build output, `.git`). Non-fatal: a non-git path or a
 * failed git invocation resolves to an empty list.
 */
function discoverMiseConfigs(
  repoPath: string,
): Effect.Effect<readonly string[], never, CommandExecutor> {
  return Effect.gen(function* () {
    if (!isGitRepo(repoPath)) return [];

    const output = yield* gitOutput(
      ["ls-files", "-z", "--", ...MISE_CONFIG_PATHSPECS],
      { cwd: repoPath },
    ).pipe(Effect.catch(() => Effect.succeed("")));

    return output
      .split("\0")
      .filter((line) => line.length > 0 && isMiseConfigPath(line))
      .map((relativePath) => join(repoPath, relativePath))
      .filter((absolutePath) => existsSync(absolutePath));
  });
}

/**
 * Mark a single mise config file as trusted via `mise trust <path>`.
 *
 * Idempotent (mise rewrites the trust marker) and non-fatal: returns whether
 * the command exited cleanly rather than failing the effect.
 */
function trustMiseConfig(
  configPath: string,
): Effect.Effect<boolean, never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const exitCode = yield* executor.exitCode("mise", ["trust", configPath], {
      cwd: HOME_DIR,
    });
    return exitCode === 0;
  });
}

/**
 * Trust every mise config file found in the repositories dot tracks.
 *
 * Enumerates tracked repos, discovers their committed mise config files, and
 * marks each trusted so `mise` never prompts for them on a fresh machine. The
 * whole step is best-effort: a missing `mise`, a non-git repo, or a failed
 * trust is logged and skipped rather than aborting the surrounding update.
 */
export const trustTrackedMiseConfigs: Effect.Effect<
  void,
  never,
  Config | CommandExecutor | OutputLog
> = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  yield* log.section("Trust Mise Configs");

  if ((yield* executor.exitCode("which", ["mise"])) !== 0) {
    yield* log.warn("Skipping mise trust (mise not installed)");
    return;
  }

  const repoRoots = trackedRepoRoots(config);
  if (repoRoots.length === 0) {
    yield* log.info("No tracked repositories to scan for mise configs");
    return;
  }

  let trusted = 0;
  let reposWithConfigs = 0;

  for (const repoPath of repoRoots) {
    const configs = yield* discoverMiseConfigs(repoPath);
    if (configs.length === 0) continue;
    reposWithConfigs += 1;

    for (const configPath of configs) {
      if (yield* trustMiseConfig(configPath)) {
        trusted += 1;
        yield* log.info(`Trusted mise config: ${displayPath(configPath)}`);
      } else {
        yield* log.warn(
          `Failed to trust mise config: ${displayPath(configPath)}`,
        );
      }
    }
  }

  if (trusted === 0) {
    yield* log.info("No mise configs found in tracked repositories");
    return;
  }

  yield* log.info(
    `Trusted ${trusted} mise config${trusted === 1 ? "" : "s"} across ${reposWithConfigs} repositor${reposWithConfigs === 1 ? "y" : "ies"}`,
  );
});
