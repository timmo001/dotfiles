import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { ENV, envString } from "./env.js";
import type { ConfigService } from "../services/Config.js";

/** Resolve the path to the public gh CLI extensions list. */
export function ghExtensionsListPath(config: ConfigService): string {
  return (
    envString(ENV.DOT_GH_EXTENSIONS_FILE) ??
    join(config.publicDotfiles, ".dot-gh-extensions")
  );
}

/**
 * Load configured gh extension repos from a list file. Each non-empty,
 * non-comment line is an `owner/repo` reference passed to `gh extension
 * install`. Returns an empty list when the file is missing.
 */
export function loadGhExtensions(filePath: string): readonly string[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/**
 * Parse `gh extension list` output into the set of installed extension repos,
 * lower-cased as `owner/repo` for case-insensitive matching. The repo column
 * is the only whitespace-separated field containing a slash.
 */
export function parseInstalledGhExtensions(
  output: string,
): ReadonlySet<string> {
  const installed = new Set<string>();
  for (const line of output.split("\n")) {
    for (const field of line.trim().split(/\s+/)) {
      if (field.includes("/")) installed.add(field.toLowerCase());
    }
  }
  return installed;
}

/**
 * Install any configured gh CLI extensions that are not already present.
 * Optional by design: a missing `gh` or a failed single-extension install is
 * logged as a warning and never aborts the caller.
 */
export const installGhExtensions: Effect.Effect<
  void,
  never,
  Config | CommandExecutor | OutputLog
> = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  yield* log.section("Install GitHub CLI Extensions");

  const desired = loadGhExtensions(ghExtensionsListPath(config));
  if (desired.length === 0) {
    yield* log.info("No gh extensions configured");
    return;
  }

  if ((yield* executor.exitCode("which", ["gh"])) !== 0) {
    yield* log.warn("gh is not installed; skipping gh extension setup");
    return;
  }

  const listed = yield* executor
    .run("gh", ["extension", "list"])
    .pipe(Effect.catch(() => Effect.succeed("")));
  const installed = parseInstalledGhExtensions(listed);

  const missing = desired.filter((repo) => !installed.has(repo.toLowerCase()));
  if (missing.length === 0) {
    yield* log.info("All configured gh extensions are installed");
    return;
  }

  for (const repo of missing) {
    yield* log.info(`Installing gh extension: ${repo}`);
    const exitCode = yield* executor.inherit("gh", [
      "extension",
      "install",
      repo,
    ]);
    if (exitCode !== 0) {
      yield* log.warn(`gh extension install ${repo} exited ${exitCode}`);
    }
  }
});
