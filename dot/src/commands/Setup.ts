import { Effect } from "effect";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher } from "../services/Launcher.js";

/**
 * Install prerequisite packages for the dotfiles system.
 *
 * Checks if `stow` is already installed. If not, installs it using
 * `omarchy-pkg-add`. This is the minimal setup needed before `dot stow`
 * or `dot install` can run.
 */
export const setup = Effect.gen(function* () {
  const log = yield* OutputLog;
  const launcher = yield* Launcher;

  yield* log.section("Setup Prerequisites");

  // Check if stow is already available
  const whichExit = yield* launcher.stream("which stow");
  if (whichExit === 0) {
    yield* log.info("Skipping setup: stow already installed");
    return;
  }

  // Check if omarchy-pkg-add is available
  const pkgAddExit = yield* launcher.stream("which omarchy-pkg-add");
  if (pkgAddExit !== 0) {
    yield* log.error(
      "Required command missing: omarchy-pkg-add (setup installs stow when absent)",
    );
    return;
  }

  yield* log.info("Installing: stow");
  yield* launcher.suspend("omarchy-pkg-add stow", { waitForKey: false });
  yield* log.info("Prerequisites installed");
});
