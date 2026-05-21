import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { CheckResult } from "../types.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;

/** Check git config includes the managed dotfiles settings */
export const checkGitConfig = Effect.gen(function* () {
  const results: CheckResult[] = [];

  const gitConfigFile = join(HOME, ".config", "git", "config");
  const gitConfigDotfiles = join(HOME, ".config", "git", "config.dotfiles");
  const gitIncludePath = "~/.config/git/config.dotfiles";

  if (existsSync(gitConfigDotfiles)) {
    if (existsSync(gitConfigFile)) {
      try {
        const content = readFileSync(gitConfigFile, "utf-8");
        if (content.includes(`path = ${gitIncludePath}`)) {
          results.push({ severity: "ok", message: "Git config includes managed dotfiles settings" });
        } else {
          results.push({
            severity: "warn",
            message: "Git config is missing the dotfiles include",
            detail: `Run: git config --global --add include.path '${gitIncludePath}'`,
          });
        }
      } catch {
        results.push({ severity: "warn", message: "Could not read git config file" });
      }
    } else {
      results.push({
        severity: "warn",
        message: "Git config file does not exist",
        detail: `Expected: ${gitConfigFile.replace(HOME, "~")}`,
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
