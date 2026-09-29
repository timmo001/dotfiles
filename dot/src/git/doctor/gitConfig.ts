import { Effect, FileSystem } from "effect";
import { join } from "path";
import { CONFIG_DIR, displayPath } from "../../lib/paths.js";
import type { CheckResult } from "../../doctor/types.js";

/** Check git config includes the managed dotfiles settings */
export const checkGitConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const results: CheckResult[] = [];

  const gitConfigFile = join(CONFIG_DIR, "git", "config");
  const gitConfigDotfiles = join(CONFIG_DIR, "git", "config.dotfiles");
  const gitIncludePath = "~/.config/git/config.dotfiles";

  if (yield* fs.exists(gitConfigDotfiles).pipe(Effect.orDie)) {
    if (yield* fs.exists(gitConfigFile).pipe(Effect.orDie)) {
      const content = yield* fs
        .readFileString(gitConfigFile)
        .pipe(Effect.orElseSucceed(() => null));

      if (content === null) {
        results.push({
          severity: "warn",
          message: "Could not read git config file",
        });
      } else if (content.includes(`path = ${gitIncludePath}`)) {
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
    } else {
      results.push({
        severity: "warn",
        message: "Git config file does not exist",
        detail: `Expected: ${displayPath(gitConfigFile)}`,
      });
    }
  } else {
    results.push({
      severity: "warn",
      message: "Stowed git config.dotfiles not found",
      detail: "Run: dot stow",
    });
  }

  return results;
});
