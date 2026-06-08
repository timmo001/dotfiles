import { Effect } from "effect";
import { existsSync, lstatSync } from "fs";
import { join } from "path";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { CONFIG_DIR, HOME_DIR, displayPath } from "../../lib/paths.js";
import { ENV, envString } from "../../lib/env.js";
import type { CheckResult } from "../types.js";

/** Check browser flags symlinks from private dotfiles */
export const checkBrowserFlags = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  const host = envString(ENV.OMARCHY_HOST) ?? "";
  const browserFlagsHostPkg = `chromium--${host}`;
  const browserFlagsPkgDir = config.privateDotfiles
    ? join(config.privateDotfiles, browserFlagsHostPkg)
    : null;
  const omarchyDefaultFlags = join(
    HOME_DIR,
    ".local",
    "share",
    "omarchy",
    "config",
    "chromium-flags.conf",
  );

  if (host && browserFlagsPkgDir && existsSync(browserFlagsPkgDir)) {
    let flagsOk = true;

    for (const flagFile of [
      join(CONFIG_DIR, "chromium-flags.conf"),
      join(CONFIG_DIR, "chrome-flags.conf"),
    ]) {
      if (!existsSync(flagFile)) {
        results.push({
          severity: "error",
          message: `Missing ${displayPath(flagFile)}`,
          detail: "Run: dot stow",
        });
        flagsOk = false;
      } else {
        try {
          const stat = lstatSync(flagFile);
          if (!stat.isSymbolicLink()) {
            results.push({
              severity: "error",
              message: `${displayPath(flagFile)} is not a symlink`,
              detail: "Run: dot stow",
            });
            flagsOk = false;
          }
        } catch {
          flagsOk = false;
        }
      }
    }

    if (flagsOk) {
      results.push({
        severity: "ok",
        message: `Browser flags stowed from ${browserFlagsHostPkg}`,
      });
    }
  } else if (host && config.canUsePrivate) {
    results.push({
      severity: "error",
      message: `Missing ${browserFlagsHostPkg} package in ${displayPath(config.privateDotfiles ?? "")}`,
    });
  } else if (!host) {
    results.push({
      severity: "warn",
      message: "OMARCHY_HOST is not set \u2014 cannot check browser flags",
    });
  } else {
    results.push({
      severity: "ok",
      message:
        "Browser flags using omarchy defaults (private repo unavailable)",
    });
  }

  // Diff live flags against omarchy defaults
  if (
    existsSync(omarchyDefaultFlags) &&
    existsSync(join(CONFIG_DIR, "chromium-flags.conf"))
  ) {
    const diffResult = yield* executor
      .run("bash", [
        "-c",
        `diff -u ${JSON.stringify(omarchyDefaultFlags)} ~/.config/chromium-flags.conf --label 'omarchy defaults' --label 'chromium-flags.conf' 2>/dev/null | grep -v '^[+-].*--oauth2-client-'`,
      ])
      .pipe(Effect.catch(() => Effect.succeed("")));

    if (!diffResult.trim()) {
      results.push({
        severity: "ok",
        message: "chromium-flags.conf is identical to omarchy defaults",
      });
    } else {
      results.push({
        severity: "ok",
        message: "chromium-flags.conf diff from omarchy defaults:",
        detail: diffResult.trim(),
      });
    }
  } else if (!existsSync(omarchyDefaultFlags)) {
    results.push({
      severity: "warn",
      message: `Omarchy default chromium-flags.conf not found at ${displayPath(omarchyDefaultFlags)}`,
    });
  }

  return results;
});
