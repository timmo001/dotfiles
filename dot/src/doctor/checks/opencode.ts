import { Effect } from "effect";
import { existsSync, lstatSync, readlinkSync } from "fs";
import { join } from "path";
import { Config } from "../../services/Config.js";
import { CONFIG_DIR, HOME_DIR, displayPath } from "../../lib/paths.js";
import type { CheckResult } from "../types.js";

/** Canonical OpenCode resource names (plural) under ~/.config/opencode/ */
const RESOURCE_NAMES = ["AGENTS.md", "agents", "commands", "plugins"] as const;

/** Legacy singular names that should no longer exist */
const LEGACY_SINGULAR_NAMES = ["agent", "command", "plugin"] as const;

/** Check OpenCode binary and config locations for legacy remnants */
export const checkOpencode = Effect.gen(function* () {
  const config = yield* Config;
  const results: CheckResult[] = [];

  results.push({
    severity: "ok",
    message:
      "OpenCode documented global resources live under ~/.config/opencode",
  });

  // Check external skills directory (~/.agents/skills/)
  const externalSkillsPath = join(HOME_DIR, ".agents", "skills");
  if (existsSync(externalSkillsPath)) {
    results.push({
      severity: "ok",
      message: `OpenCode external skills path exists: ${displayPath(externalSkillsPath)}`,
    });
  } else {
    results.push({
      severity: "warn",
      message: `OpenCode external skills path missing: ${displayPath(externalSkillsPath)}`,
    });
  }

  // Warn if legacy skills dir still exists under ~/.config/opencode/
  const legacySkillsPath = join(CONFIG_DIR, "opencode", "skills");
  if (existsSync(legacySkillsPath) || lstatExists(legacySkillsPath)) {
    results.push({
      severity: "warn",
      message: `Legacy skills path still exists: ${displayPath(legacySkillsPath)} (skills now live at ~/.agents/skills/)`,
    });
  }

  let foundLegacy = false;

  for (const name of RESOURCE_NAMES) {
    const canonicalPath = join(CONFIG_DIR, "opencode", name);
    const legacyPath = join(HOME_DIR, ".opencode", name);

    if (existsSync(canonicalPath)) {
      results.push({
        severity: "ok",
        message: `OpenCode canonical path exists: ${displayPath(canonicalPath)}`,
      });
    } else {
      results.push({
        severity: "warn",
        message: `OpenCode canonical path missing: ${displayPath(canonicalPath)}`,
      });
    }

    if (existsSync(legacyPath) || lstatExists(legacyPath)) {
      foundLegacy = true;
      const isSymlink =
        lstatExists(legacyPath) && lstatSync(legacyPath).isSymbolicLink();
      if (isSymlink) {
        const target = readlinkSync(legacyPath);
        results.push({
          severity: "warn",
          message: `Legacy OpenCode path still exists: ${displayPath(legacyPath)} -> ${target}`,
        });
      } else {
        results.push({
          severity: "warn",
          message: `Legacy OpenCode path still exists: ${displayPath(legacyPath)}`,
        });
      }
      results.push({
        severity: "warn",
        message: `Move/remove legacy OpenCode resources after confirming ${displayPath(canonicalPath)} is correct`,
      });
    }
  }

  // Check legacy singular names
  for (const name of LEGACY_SINGULAR_NAMES) {
    for (const base of [
      join(CONFIG_DIR, "opencode"),
      join(HOME_DIR, ".opencode"),
    ]) {
      const path = join(base, name);
      if (existsSync(path) || lstatExists(path)) {
        foundLegacy = true;
        const isSymlink = lstatExists(path) && lstatSync(path).isSymbolicLink();
        if (isSymlink) {
          const target = readlinkSync(path);
          results.push({
            severity: "warn",
            message: `Legacy OpenCode singular path still exists: ${displayPath(path)} -> ${target}`,
          });
        } else {
          results.push({
            severity: "warn",
            message: `Legacy OpenCode singular path still exists: ${displayPath(path)}`,
          });
        }
        results.push({
          severity: "warn",
          message:
            "Remove legacy singular OpenCode paths after confirming the plural ~/.config/opencode/* resources are correct",
        });
      }
    }
  }

  // Check legacy stow sources
  for (const legacySource of [
    join(config.publicDotfiles, "agents/.opencode"),
    ...(config.privateDotfiles
      ? [join(config.privateDotfiles, "agents/.opencode")]
      : []),
  ]) {
    if (existsSync(legacySource) || lstatExists(legacySource)) {
      foundLegacy = true;
      results.push({
        severity: "warn",
        message: `Legacy OpenCode stow source still exists: ${displayPath(legacySource)}`,
        detail:
          "Use agents/.config/opencode in the public/private dotfiles repos instead",
      });
    }
  }

  if (!foundLegacy) {
    results.push({
      severity: "ok",
      message:
        "No legacy OpenCode resource paths found under ~/.opencode or stow sources",
    });
  }

  return results;
});

/** Safe lstat check that returns false instead of throwing */
function lstatExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
