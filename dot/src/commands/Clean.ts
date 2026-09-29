import { Effect } from "effect";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { listStowFolders } from "../lib/stowFolders.js";
import { runStow, type StowScope } from "../lib/stowPackages.js";
import { displayPath } from "../lib/paths.js";
import { cliStyler } from "../lib/ansi.js";
import { logRunSummary, plural } from "../lib/runSummary.js";

/**
 * Unstow all packages from private (if available) and public dotfiles repos.
 *
 * Runs `stow -D <folder>` for each stow package directory, removing all
 * managed symlinks. Private is unstowed first, then public.
 */
export const clean = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;

  const actions: string[] = [];

  if (config.canUsePrivate && config.privateDotfiles) {
    yield* log.section("Unstow Private Dotfiles");

    const count = yield* unstowRepo(config.privateDotfiles, "private");

    actions.push(`Unstowed ${plural(count, "private package")}`);
  }

  yield* log.section("Unstow Public Dotfiles");

  const count = yield* unstowRepo(config.publicDotfiles, "public");

  actions.push(`Unstowed ${plural(count, "public package")}`);

  yield* logRunSummary("Summary", actions);
});

/** Unstow all folders in a single repo */
const unstowRepo = Effect.fn("clean.unstowRepo")(function* (
  repoDir: string,
  scope: StowScope,
) {
  const config = yield* Config;
  const log = yield* OutputLog;
  const folders = (yield* listStowFolders(repoDir, config)).sort();
  const style = cliStyler();

  yield* log.info(style.dim(displayPath(repoDir)));

  for (const folder of folders) {
    yield* runStow(repoDir, scope, "unstow", folder, ["-D", folder]);
    yield* log.success(style.accent(folder));
  }

  return folders.length;
});
