import { Effect } from "effect";
import { ensureStowInstalled } from "../lib/packageSetup.js";

/**
 * Install prerequisite packages for the dotfiles system.
 *
 * Checks if `stow` is already installed. If not, installs it using
 * `omarchy-pkg-add`. This is the minimal setup needed before `dot stow`
 * or `dot install` can run.
 */
export const setup = Effect.gen(function* () {
  yield* ensureStowInstalled;
});
