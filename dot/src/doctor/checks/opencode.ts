import { Effect } from "effect";
import { join } from "path";
import { lstatOrNull, pathExists, readLinkOrNull } from "../../lib/fsProbe.js";
import { missingExternalSkills } from "../../lib/externalSkills.js";
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

  if (yield* pathExists(externalSkillsPath)) {
    results.push({
      severity: "ok",
      message: `OpenCode external skills path exists: ${displayPath(externalSkillsPath)}`,
    });

    const missing = yield* missingExternalSkills(externalSkillsPath);

    if (missing.length > 0)
      results.push({
        severity: "warn",
        message: `External skills missing SKILL.md: ${missing.join(", ")} (run dot stow)`,
      });
  } else {
    results.push({
      severity: "warn",
      message: `OpenCode external skills path missing: ${displayPath(externalSkillsPath)}`,
    });
  }

  // Warn if legacy skills dir still exists under ~/.config/opencode/
  const legacySkillsPath = join(CONFIG_DIR, "opencode", "skills");

  if (yield* entryPresent(legacySkillsPath)) {
    results.push({
      severity: "warn",
      message: `Legacy skills path still exists: ${displayPath(legacySkillsPath)} (skills now live at ~/.agents/skills/)`,
    });
  }

  let foundLegacy = false;

  for (const name of RESOURCE_NAMES) {
    const canonicalPath = join(CONFIG_DIR, "opencode", name);
    const legacyPath = join(HOME_DIR, ".opencode", name);

    if (yield* pathExists(canonicalPath)) {
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

    if (yield* entryPresent(legacyPath)) {
      foundLegacy = true;

      const target = yield* readLinkOrNull(legacyPath);

      if (target !== null) {
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

      if (yield* entryPresent(path)) {
        foundLegacy = true;
        const target = yield* readLinkOrNull(path);

        if (target !== null) {
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
    if (yield* entryPresent(legacySource)) {
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

/** Whether an entry exists, including a broken symlink. */
const entryPresent = Effect.fn("Opencode.entryPresent")(function* (
  path: string,
) {
  return (yield* lstatOrNull(path)) !== null;
});
