import { Effect } from "effect";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher } from "../services/Launcher.js";
import { stow as runStow } from "./Stow.js";
import { rebuild } from "../lib/selfUpdate.js";

const displayPath = (p: string): string =>
  p.replace(process.env.HOME ?? "", "~");

/** Pull a single repo, streaming git output through OutputLog */
const pullRepo = (name: string, path: string) =>
  Effect.gen(function* () {
    const log = yield* OutputLog;
    const launcher = yield* Launcher;
    yield* log.info(`Pulling ${name} (${displayPath(path)})...`);
    const exit = yield* launcher.stream("git pull --rebase --no-edit", {
      cwd: path,
    });
    if (exit !== 0) {
      yield* log.warn(`Pull failed for ${name} (exit ${exit})`);
    }
  });

/** Sync omarchy repos via the omarchy CLI (non-fatal on failure) */
const omarchySync = Effect.gen(function* () {
  const log = yield* OutputLog;
  const launcher = yield* Launcher;

  yield* log.section("Omarchy Repo Sync");
  const exit = yield* launcher.stream("omarchy update git");
  if (exit !== 0) {
    yield* log.warn("Omarchy sync skipped or failed (non-fatal)");
  }
});

/** Run post-update hooks (agents-sync, skill-updates) via dot-legacy */
const postHooks = Effect.gen(function* () {
  const log = yield* OutputLog;
  const launcher = yield* Launcher;

  yield* log.section("Post-Hooks");

  const agentsExit = yield* launcher.stream("dot-legacy agents-sync");
  if (agentsExit !== 0) {
    yield* log.warn("Agents sync failed (non-fatal)");
  }

  const skillsExit = yield* launcher.stream(
    "dot-legacy skill-updates --update",
  );
  if (skillsExit !== 0) {
    yield* log.warn("Skill updates failed (non-fatal)");
  }
});

/**
 * Run `dot update`: pull repos, sync omarchy, restow dotfiles, rebuild the binary.
 *
 * Flags are inclusive — passing any of pull/stow/tui selects only those
 * steps; if none are set, all three run (legacy semantics).
 */
export const update = (opts?: {
  readonly pull?: boolean;
  readonly stow?: boolean;
  readonly tui?: boolean;
}) =>
  Effect.gen(function* () {
    const anyFlag = !!(opts?.pull || opts?.stow || opts?.tui);
    const doPull = anyFlag ? !!opts?.pull : true;
    const doStow = anyFlag ? !!opts?.stow : true;
    const doTui = anyFlag ? !!opts?.tui : true;

    const config = yield* Config;
    const log = yield* OutputLog;

    yield* log.section("Update Workflow");

    if (doPull) {
      yield* log.section("Pull Repositories");
      yield* pullRepo("dotfiles", config.publicDotfiles);
      if (config.canUsePrivate && config.privateDotfiles) {
        yield* pullRepo("dotfiles-private", config.privateDotfiles);
      } else {
        yield* log.warn(
          "Skipping private pull (private dotfiles not available)",
        );
      }

      // Omarchy sync (external CLI — non-fatal)
      yield* omarchySync;
    }

    if (doStow) {
      yield* runStow();
    }

    if (doTui) {
      yield* log.section("Rebuild");
      yield* rebuild;
      yield* log.info("Build successful");
    }

    // Post-hooks run after a full update (all steps) to match legacy behaviour
    if (!anyFlag) {
      yield* postHooks;
    }
  });
