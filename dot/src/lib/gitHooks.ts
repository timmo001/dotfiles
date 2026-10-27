import { Effect } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { gitExitCode } from "./git.js";
import { HOME_DIR } from "./paths.js";
import { done, skip, warn } from "./updateSummary.js";
import type { RecapEntry } from "./updateSummary.js";

/**
 * Whether hk's global hooks are installed: `hk install --global` writes
 * `hook.hk-*` entries into the global git config.
 */
export const hasGlobalHkHooks: Effect.Effect<boolean, never, CommandExecutor> =
  gitExitCode(["config", "--global", "--get-regexp", "^hook\\.hk-"]).pipe(
    Effect.map((code) => code === 0),
    Effect.withSpan("gitHooks.hasGlobalHkHooks"),
  );

/**
 * Install hk's hooks once for every repository on this machine, running them
 * through `mise x` so repository tools resolve. Repositories without an
 * `hk.pkl` skip them, and hooks in `.git/hooks` keep running alongside. A
 * failed install warns rather than fails, so it never stops an update.
 */
export const ensureGlobalHkHooks: Effect.Effect<
  RecapEntry,
  never,
  CommandExecutor | OutputLog
> = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;

  yield* log.section("Git Hooks");

  if ((yield* executor.exitCode("mise", ["which", "hk"])) !== 0) {
    yield* log.info("hk is not installed; skipping git hooks");

    return skip("Git hooks skipped (hk not installed)");
  }

  if (yield* hasGlobalHkHooks) {
    yield* log.info("Global hk hooks are already installed");

    return skip("Global hk hooks already installed");
  }

  const exitCode = yield* executor.inherit(
    "mise",
    ["exec", "--", "hk", "install", "--global", "--mise"],
    { cwd: HOME_DIR },
  );

  if (exitCode !== 0) {
    yield* log.warn(`hk install --global exited ${exitCode}`);

    return warn(`hk install --global exited ${exitCode}`);
  }

  yield* log.success("Installed global hk hooks");

  return done("Installed global hk hooks");
}).pipe(Effect.withSpan("gitHooks.ensureGlobalHkHooks"));
