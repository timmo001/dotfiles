import { Effect } from "effect";
import { join } from "path";
import { pathExists } from "../../lib/fsProbe.js";
import { missingExternalSkills } from "../../lib/externalSkills.js";
import { CONFIG_DIR, HOME_DIR, displayPath } from "../../lib/paths.js";
import type { CheckResult } from "../types.js";

/** Canonical OpenCode resource names (plural) under ~/.config/opencode/ */
const RESOURCE_NAMES = ["AGENTS.md", "agents", "commands", "plugins"] as const;

/** Check OpenCode config resources and external skills are in place */
export const checkOpencode = Effect.gen(function* () {
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

  for (const name of RESOURCE_NAMES) {
    const canonicalPath = join(CONFIG_DIR, "opencode", name);

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
  }

  return results;
});
