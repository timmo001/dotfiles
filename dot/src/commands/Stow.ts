import { Effect } from "effect";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { displayPath } from "../lib/paths.js";
import { ensureNvimThemeLink } from "../lib/omarchyNvim.js";
import { disableOmarchyCrashCapture } from "../lib/omarchyCrashCapture.js";
import { applyOmarchyShellConfig } from "../lib/omarchyShellConfig.js";
import {
  writeCaptureRepositoryOptions,
  writeRepoPicker,
  writeRepoShortcuts,
} from "../lib/repoShortcuts.js";
import { captureRepositoryOptions } from "./NotesCaptureSync.js";
import { writeAllCompletions } from "./Completions.js";
import { installOpencodePluginDependencies } from "../lib/opencodePlugins.js";
import { syncSkills } from "../lib/externalSkills.js";
import { applySyncthingConfig } from "../lib/syncthing.js";
import { applySecretFiles } from "../lib/secretFiles.js";
import {
  backupUnmanagedTargets,
  emptyStowCounts,
  removeRetiredStowState,
  stowRepo,
} from "../lib/stowPackages.js";
import { cliStyler } from "../lib/ansi.js";
import { plural } from "../lib/runSummary.js";
import { done, notable, skip, warn } from "../lib/updateSummary.js";
import type { RecapEntry } from "../lib/updateSummary.js";

/** Result of a stow run. */
export interface StowResult {
  /** Whether the generated `shell.json` or a deployed Omarchy plugin changed. */
  readonly shellChanged: boolean;
  /** Actions taken or skipped in order, for a closing summary. */
  readonly actions: readonly RecapEntry[];
}

/**
 * Run GNU Stow per-folder for the public and (optionally) private dotfiles repos.
 *
 * Matches legacy behaviour: enumerates stow package directories, logs each one,
 * and applies per-folder stow with appropriate flags.
 *
 * @returns Whether the generated Omarchy `shell.json` or a deployed plugin
 *   changed, so the caller can restart the running shell, and the actions
 *   taken or skipped for a summary.
 */
export const stow = (opts?: {
  readonly publicOnly?: boolean;
  readonly privateOnly?: boolean;
}) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const style = cliStyler();

    const runPublic = !opts?.privateOnly;
    const runPrivate = !opts?.publicOnly;

    let shellConfigChanged = false;
    const actions: RecapEntry[] = [];
    const counts = emptyStowCounts();

    if (runPrivate && config.canUsePrivate && config.gitConfig.valid) {
      const shortcutsPath = yield* Effect.sync(() =>
        writeRepoShortcuts(config.cacheDir, [
          ...config.gitConfig.repositories,
          ...config.gitConfig.shortcuts,
        ]),
      );

      const pickerPath = yield* Effect.sync(() =>
        writeRepoPicker(config.cacheDir, [
          ...config.gitConfig.repositories,
          ...config.gitConfig.shortcuts,
        ]),
      );

      const captureRepositoriesPath = yield* Effect.sync(() =>
        writeCaptureRepositoryOptions(
          config.cacheDir,
          captureRepositoryOptions(config.gitConfig.repositories),
        ),
      );

      yield* log.success(
        `Generated repository shortcuts ${style.dim(displayPath(shortcutsPath))}`,
      );
      yield* log.success(
        `Generated Herdr repository picker ${style.dim(displayPath(pickerPath))}`,
      );
      yield* log.success(
        `Generated Notes capture repositories ${style.dim(displayPath(captureRepositoriesPath))}`,
      );
      actions.push(done("Generated repository shortcuts and pickers"));
    } else if (runPrivate && config.canUsePrivate) {
      yield* log.warn(
        "Keeping repository shortcuts because dot-git.yml is invalid",
      );
      actions.push(warn("Repository shortcuts kept (dot-git.yml is invalid)"));
    }

    if (runPublic) {
      yield* log.section("Completions");

      const completions = yield* writeAllCompletions;

      for (const target of completions) {
        yield* log.success(`Generated ${style.dim(displayPath(target))}`);
      }

      actions.push(
        done(`Generated ${plural(completions.length, "completion file")}`),
      );

      yield* log.section("OpenCode Plugins");
      yield* log.success(
        `Installed dependencies ${style.dim(displayPath(yield* installOpencodePluginDependencies))}`,
      );
      actions.push(done("Installed OpenCode plugin dependencies"));

      yield* log.section("Stow Public Dotfiles");
      yield* removeRetiredStowState(counts);
      yield* backupUnmanagedTargets(config.publicDotfiles, counts);
      yield* stowRepo(config.publicDotfiles, "public", counts);
      actions.push(done(`Stowed ${plural(counts.public, "public package")}`));

      yield* log.section("Omarchy Neovim Theme");
      yield* ensureNvimThemeLink(log);

      yield* log.section("Omarchy Crash Notifications");
      actions.push(...(yield* disableOmarchyCrashCapture));

      yield* log.section("Omarchy Shell Config");
      shellConfigChanged = yield* applyOmarchyShellConfig;

      actions.push(
        shellConfigChanged
          ? notable("Regenerated Omarchy shell config")
          : skip("Omarchy shell config unchanged"),
      );
    }

    if (runPrivate) {
      if (config.canUsePrivate && config.privateDotfiles) {
        yield* log.section("Stow Private Dotfiles");
        yield* backupUnmanagedTargets(config.privateDotfiles, counts);
        yield* stowRepo(config.privateDotfiles, "private", counts);
        actions.push(
          done(`Stowed ${plural(counts.private, "private package")}`),
        );
        actions.push(...(yield* applySyncthingConfig));
        actions.push(...(yield* applySecretFiles));
      } else {
        yield* log.warn(
          "Skipping private stow (private dotfiles not available)",
        );
        actions.push(
          warn("Private stow skipped (private dotfiles not available)"),
        );
      }
    }

    if (runPublic) actions.push(...(yield* syncSkills));

    if (counts.deployed > 0)
      actions.push(
        notable(`Deployed ${plural(counts.deployed, "Omarchy plugin")}`),
      );

    if (counts.backedUp > 0)
      actions.push(
        notable(`Backed up ${plural(counts.backedUp, "unmanaged target")}`),
      );

    if (counts.removed > 0)
      actions.push(
        notable(`Removed ${plural(counts.removed, "retired link")}`),
      );

    return {
      shellChanged: shellConfigChanged || counts.deployed > 0,
      actions,
    } satisfies StowResult;
  });
