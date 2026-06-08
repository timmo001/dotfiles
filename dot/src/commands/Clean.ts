import { Effect } from "effect";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher, LauncherError } from "../services/Launcher.js";
import { listStowFolders } from "../lib/stowFolders.js";
import { displayPath } from "../lib/paths.js";

/**
 * Unstow all packages from private (if available) and public dotfiles repos.
 *
 * Runs `stow -D <folder>` for each stow package directory, removing all
 * managed symlinks. Private is unstowed first, then public.
 */
export const clean = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;
  const launcher = yield* Launcher;

  if (config.canUsePrivate && config.privateDotfiles) {
    yield* log.section("Unstow Private Dotfiles");
    yield* unstowRepo(config.privateDotfiles, "private", launcher, log);
  }

  yield* log.section("Unstow Public Dotfiles");
  yield* unstowRepo(config.publicDotfiles, "public", launcher, log);

  yield* log.section("Complete");
  yield* log.info("All packages unstowed");
});

/** Unstow all folders in a single repo */
const unstowRepo = (
  repoDir: string,
  scope: "public" | "private",
  launcher: {
    readonly stream: (
      cmd: string,
      opts?: { readonly cwd?: string },
    ) => Effect.Effect<number, LauncherError>;
  },
  log: {
    readonly info: (msg: string) => Effect.Effect<void>;
    readonly error: (msg: string) => Effect.Effect<void>;
  },
) =>
  Effect.gen(function* () {
    const folders = listStowFolders(repoDir).sort();
    const repoDisplayPath = displayPath(repoDir);

    for (const folder of folders) {
      yield* log.info(`[${scope}] unstow ${folder} (repo: ${repoDisplayPath})`);
      const exit = yield* launcher.stream(`stow -D ${folder}`, {
        cwd: repoDir,
      });

      if (exit !== 0) {
        yield* log.error(`[${scope}] unstow ${folder} failed (exit ${exit})`);
        return yield* Effect.fail(
          new LauncherError(`${scope} unstow failed on ${folder}`, exit),
        );
      }
    }
  });
