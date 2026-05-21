import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Config } from "../../services/Config.js";
import type { CheckResult } from "../types.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;

function displayPath(p: string): string {
  return p.replace(HOME, "~");
}

/**
 * Check browser extensions from private config.
 *
 * The private config file uses pipe-delimited lines:
 * `kind|profile_dir|target|label|hint`
 */
export const checkBrowserExtensions = Effect.gen(function* () {
  const config = yield* Config;
  const results: CheckResult[] = [];

  if (!config.canUsePrivate) {
    results.push({
      severity: "warn",
      message: `Skipping browser extension checks (${config.privateReason})`,
    });
    return results;
  }

  const configFile =
    process.env.DOT_PRIVATE_BROWSER_CHECKS_FILE ??
    (config.privateDotfiles ? join(config.privateDotfiles, ".dot-browser-checks") : null);

  if (!configFile || !existsSync(configFile)) {
    results.push({ severity: "ok", message: "No private browser checks configured" });
    return results;
  }

  let content: string;
  try {
    content = readFileSync(configFile, "utf-8");
  } catch {
    results.push({ severity: "warn", message: `Could not read browser checks file: ${displayPath(configFile)}` });
    return results;
  }

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const [kind, rawProfileDir, target, label, hint] = line.split("|").map((s) => s.trim());
    if (!kind || !rawProfileDir || !target || !label) continue;

    const profileDir = rawProfileDir.replace(/^~/, HOME);

    if (!existsSync(profileDir)) {
      results.push({
        severity: "warn",
        message: `Chromium profile not found: ${displayPath(profileDir)}`,
      });
      continue;
    }

    const prefsFile = join(profileDir, "Preferences");
    if (!existsSync(prefsFile)) {
      results.push({
        severity: "warn",
        message: `${label} \u2014 Preferences file not found in ${displayPath(profileDir)}`,
      });
      continue;
    }

    let prefs: string;
    try {
      prefs = readFileSync(prefsFile, "utf-8");
    } catch {
      results.push({ severity: "warn", message: `Could not read Preferences for ${label}` });
      continue;
    }

    let found = false;
    if (kind === "chromium-id") {
      // Check by extension ID in extensions.settings
      found = prefs.includes(`"${target}"`);
    } else if (kind === "chromium-name") {
      // Check by extension name in manifest
      found = prefs.includes(`"name": "${target}"`) || prefs.includes(`"${target}"`);
    }

    if (found) {
      results.push({
        severity: "ok",
        message: `${label} is installed in ${displayPath(profileDir)}`,
      });
    } else {
      results.push({
        severity: "warn",
        message: `${label} is missing from ${displayPath(profileDir)}`,
        detail: hint || undefined,
      });
    }
  }

  return results;
});
