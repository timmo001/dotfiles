import { Effect, Schema } from "effect";
import { join } from "path";
import { pathExists, readTextOrNull } from "../../lib/fsProbe.js";
import { Config } from "../../services/Config.js";
import { displayPath, expandHomePath } from "../../lib/paths.js";
import { ENV, envString } from "../../lib/env.js";
import type { CheckResult } from "../types.js";

/**
 * Check browser extensions from private config.
 *
 * The private config file uses pipe-delimited lines:
 * `kind|profile_dir|target|label|hint`
 * Append `-absent` to a kind when the extension must not be installed.
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
    envString(ENV.DOT_PRIVATE_BROWSER_CHECKS_FILE) ??
    (config.privateDotfiles
      ? join(config.privateDotfiles, ".dot-browser-checks")
      : null);

  if (!configFile || !(yield* pathExists(configFile))) {
    results.push({
      severity: "ok",
      message: "No private browser checks configured",
    });

    return results;
  }

  const content = yield* readTextOrNull(configFile);

  if (content === null) {
    results.push({
      severity: "warn",
      message: `Could not read browser checks file: ${displayPath(configFile)}`,
    });

    return results;
  }

  results.push(...(yield* browserExtensionResults(content)));

  return results;
});

/** Evaluate browser extension checks from pipe-delimited private config. */
export const browserExtensionResults = Effect.fn("BrowserExtensions.results")(
  function* (content: string) {
    const results: CheckResult[] = [];

    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) continue;

      const [kind, rawProfileDir, target, label, hint] = line
        .split("|")
        .map((s) => s.trim());

      if (!kind || !rawProfileDir || !target || !label) continue;

      const profileDir = expandHomePath(rawProfileDir);

      if (!(yield* pathExists(profileDir))) {
        results.push({
          severity: "warn",
          message: `Chromium profile not found: ${displayPath(profileDir)}`,
        });
        continue;
      }

      const prefsFile = join(profileDir, "Preferences");

      if (!(yield* pathExists(prefsFile))) {
        results.push({
          severity: "warn",
          message: `${label} \u2014 Preferences file not found in ${displayPath(profileDir)}`,
        });
        continue;
      }

      const prefs = yield* readTextOrNull(prefsFile);

      if (prefs === null) {
        results.push({
          severity: "warn",
          message: `Could not read Preferences for ${label}`,
        });
        continue;
      }

      const mustBeAbsent = kind.endsWith("-absent");
      const lookupKind = mustBeAbsent ? kind.slice(0, -"-absent".length) : kind;
      let found = false;

      if (lookupKind === "chromium-id") {
        // Check by extension ID in extensions.settings
        found = prefs.includes(`"${target}"`);
      } else if (lookupKind === "chromium-name") {
        // Check by extension name — first try the Preferences JSON directly
        found =
          prefs.includes(`"name": "${target}"`) ||
          prefs.includes(`"${target}"`);

        // Fallback: read actual manifest.json files from extension paths on disk
        // (the name may not be cached in Preferences for unpacked extensions)
        if (!found) {
          found = yield* extensionManifestIncludesName(prefs, target);
        }
      }

      if (found && mustBeAbsent) {
        results.push({
          severity: "error",
          message: `${label} must be removed from ${displayPath(profileDir)}`,
          detail: hint || undefined,
        });
      } else if (found) {
        results.push({
          severity: "ok",
          message: `${label} is installed in ${displayPath(profileDir)}`,
        });
      } else if (!mustBeAbsent) {
        results.push({
          severity: "warn",
          message: `${label} is missing from ${displayPath(profileDir)}`,
          detail: hint || undefined,
        });
      }
    }

    return results;
  },
);

const extensionManifestIncludesName = Effect.fn(
  "BrowserExtensions.manifestIncludesName",
)(function* (prefs: string, target: string) {
  const settings = (() => {
    try {
      const parsed = Schema.decodeUnknownSync(
        Schema.Struct({
          extensions: Schema.optional(
            Schema.Struct({
              settings: Schema.optional(
                Schema.Record(
                  Schema.String,
                  Schema.Struct({ path: Schema.optional(Schema.String) }),
                ),
              ),
            }),
          ),
        }),
      )(JSON.parse(prefs));

      return parsed.extensions?.settings;
    } catch {
      return undefined;
    }
  })();

  if (!settings) return false;

  for (const ext of Object.values(settings)) {
    if (!ext.path) continue;
    const manifest = yield* readTextOrNull(join(ext.path, "manifest.json"));

    if (manifest?.includes(`"name": "${target}"`)) return true;
  }

  return false;
});
