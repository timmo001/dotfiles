import { Effect, FileSystem } from "effect";
import { join } from "path";
import { gitGlobalIncludes } from "../../lib/git.js";
import { CONFIG_DIR } from "../../lib/paths.js";
import type { CheckResult } from "../../doctor/types.js";

/** Check git config includes the managed dotfiles settings */
export const checkGitConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const results: CheckResult[] = [];

  const gitConfigDotfiles = join(CONFIG_DIR, "git", "config.dotfiles");
  const gitIncludePath = "~/.config/git/config.dotfiles";

  if (!(yield* fs.exists(gitConfigDotfiles).pipe(Effect.orDie))) {
    results.push({
      severity: "warn",
      message: "Stowed git config.dotfiles not found",
      detail: "Run: dot stow",
    });
  } else if (yield* gitGlobalIncludes(gitIncludePath)) {
    results.push({
      severity: "ok",
      message: "Git config includes managed dotfiles settings",
    });
  } else {
    results.push({
      severity: "warn",
      message: "Git config is missing the dotfiles include",
      detail: `Run: git config --global --add include.path '${gitIncludePath}'`,
    });
  }

  return results;
});
