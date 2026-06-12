import { Effect } from "effect";
import { Config } from "../../services/Config.js";
import { detectLegacyHyprRepo } from "../../lib/omarchyHost.js";
import { displayPath } from "../../lib/paths.js";
import type { CheckResult } from "../types.js";

/**
 * Flag a machine still tracking the retired external Hypr clone.
 *
 * The Hypr config is now a stowed dotfiles package. While `~/.config/hypr`
 * remains the old `omarchy-hypr` git clone, stow cannot take over, so this
 * surfaces as an error with concrete remediation.
 */
export const checkLegacyHyprRepo = Effect.gen(function* () {
  const config = yield* Config;
  const legacy = detectLegacyHyprRepo(config);

  if (!legacy.present) {
    return [
      {
        severity: "ok",
        message: "No legacy omarchy-hypr clone (Hypr config is stowed)",
      },
    ] satisfies CheckResult[];
  }

  const path = displayPath(legacy.repoPath);
  return [
    {
      severity: "error",
      message: `Legacy omarchy-hypr clone present at ${path}`,
      detail: `Back it up (keep shaders/), then re-stow: mv ${path} ${path}.bak && dot stow --public && cp -a ${path}.bak/shaders ${path}/`,
    },
  ] satisfies CheckResult[];
});
