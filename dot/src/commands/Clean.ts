import { Effect } from "effect";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher, LauncherError } from "../services/Launcher.js";
import { listStowFolders } from "../lib/stowFolders.js";
import { displayPath } from "../lib/paths.js";
import { cliStyler } from "../lib/ansi.js";
import { logRunSummary, plural } from "../lib/runSummary.js";
import type { ConfigService } from "../services/Config.js";
import type { OutputLogService } from "../services/OutputLog.js";

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

  const actions: string[] = [];

  if (config.canUsePrivate && config.privateDotfiles) {
    yield* log.section("Unstow Private Dotfiles");

    const count = yield* unstowRepo(
      config.privateDotfiles,
      "private",
      launcher,
      log,
      config,
    );

    actions.push(`Unstowed ${plural(count, "private package")}`);
  }

  yield* log.section("Unstow Public Dotfiles");

  const count = yield* unstowRepo(
    config.publicDotfiles,
    "public",
    launcher,
    log,
    config,
  );

  actions.push(`Unstowed ${plural(count, "public package")}`);

  yield* logRunSummary("Summary", actions);
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
  log: Pick<OutputLogService, "success" | "info" | "error">,
  config: ConfigService,
) =>
  Effect.gen(function* () {
    const folders = listStowFolders(repoDir, config).sort();
    const style = cliStyler();

    yield* log.info(style.dim(displayPath(repoDir)));

    for (const folder of folders) {
      const exit = yield* launcher.stream(`stow -D ${folder}`, {
        cwd: repoDir,
      });

      if (exit !== 0) {
        yield* log.error(`[${scope}] unstow ${folder} failed (exit ${exit})`);

        return yield* new LauncherError({
          message: `${scope} unstow failed on ${folder}`,
          exitCode: exit,
        });
      }

      yield* log.success(style.accent(folder));
    }

    return folders.length;
  });
