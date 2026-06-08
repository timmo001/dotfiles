import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Config } from "../../services/Config.js";
import { displayPath, expandHomePath } from "../../lib/paths.js";
import type { CheckResult } from "../types.js";

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
    (config.privateDotfiles
      ? join(config.privateDotfiles, ".dot-browser-checks")
      : null);

  if (!configFile || !existsSync(configFile)) {
    results.push({
      severity: "ok",
      message: "No private browser checks configured",
    });
    return results;
  }

  let content: string;
  try {
    content = readFileSync(configFile, "utf-8");
  } catch {
    results.push({
      severity: "warn",
      message: `Could not read browser checks file: ${displayPath(configFile)}`,
    });
    return results;
  }

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const [kind, rawProfileDir, target, label, hint] = line
      .split("|")
      .map((s) => s.trim());
    if (!kind || !rawProfileDir || !target || !label) continue;

    const profileDir = expandHomePath(rawProfileDir);

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
      results.push({
        severity: "warn",
        message: `Could not read Preferences for ${label}`,
      });
      continue;
    }

    let found = false;
    if (kind === "chromium-id") {
      // Check by extension ID in extensions.settings
      found = prefs.includes(`"${target}"`);
    } else if (kind === "chromium-name") {
      // Check by extension name — first try the Preferences JSON directly
      found =
        prefs.includes(`"name": "${target}"`) || prefs.includes(`"${target}"`);

      // Fallback: read actual manifest.json files from extension paths on disk
      // (the name may not be cached in Preferences for unpacked extensions)
      if (!found) {
        try {
          const parsed = JSON.parse(prefs);
          const settings = parsed?.extensions?.settings;
          if (settings && typeof settings === "object") {
            for (const ext of Object.values(settings) as Array<{
              path?: string;
            }>) {
              if (!ext?.path) continue;
              const manifestPath = join(ext.path, "manifest.json");
              if (!existsSync(manifestPath)) continue;
              try {
                const manifest = readFileSync(manifestPath, "utf-8");
                if (manifest.includes(`"name": "${target}"`)) {
                  found = true;
                  break;
                }
              } catch {
                /* skip unreadable manifests */
              }
            }
          }
        } catch {
          /* ignore JSON parse errors */
        }
      }
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
