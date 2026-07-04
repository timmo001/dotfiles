import { Effect } from "effect";
import { existsSync } from "fs";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { displayPath } from "../../lib/paths.js";
import {
  firewallRuleSpecs,
  presentUfwTuples,
  ufwRulesFilePath,
} from "../../lib/firewallSetup.js";
import type { CheckResult } from "../types.js";

/**
 * Check that the managed ufw firewall rules are present and carry their
 * expected purpose comment.
 *
 * Reads the world-readable ufw user.rules file (no elevation), so it runs
 * non-interactively inside the parallel doctor runner. Reports a warning per
 * missing rule unit (with the command to add it), a warning when a rule
 * exists without its expected comment, or a single warning when ufw is not
 * installed.
 */
export const checkFirewall = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  const hasUfw = (yield* executor.exitCode("which", ["ufw"])) === 0;
  if (!hasUfw) {
    results.push({
      severity: "warn",
      message: "ufw is not installed; firewall rules not checked",
      detail:
        "Install ufw and run dot init to configure managed firewall rules",
    });
    return results;
  }

  const rulesPath = ufwRulesFilePath();
  if (!existsSync(rulesPath)) {
    results.push({
      severity: "warn",
      message: `ufw rules file not found: ${displayPath(rulesPath)}`,
      detail: "Enable ufw and run dot init to configure managed firewall rules",
    });
    return results;
  }

  const present = presentUfwTuples();
  const missing: string[] = [];
  let needsReconcile = false;

  for (const spec of firewallRuleSpecs()) {
    const tuple = present.get(spec.tupleKey);
    if (!tuple) {
      results.push({
        severity: "warn",
        message: `Firewall rule missing: ${spec.describe} (${spec.comment})`,
      });
      missing.push(`${spec.addArgs.join(" ")} comment '${spec.comment}'`);
    } else if (tuple.comment !== spec.comment) {
      needsReconcile = true;
      results.push({
        severity: "warn",
        message: `Firewall rule present without its comment: ${spec.describe} (expected '${spec.comment}')`,
      });
    } else {
      results.push({
        severity: "ok",
        message: `Firewall rule present: ${spec.describe} (${spec.comment})`,
      });
    }
  }

  if (missing.length > 0) {
    results.push({
      severity: "warn",
      message: `Add with: ${missing.map((entry) => `sudo ufw ${entry}`).join("; ")}; sudo ufw reload`,
      detail: "Or run dot init to configure managed firewall rules",
    });
  }

  if (needsReconcile) {
    results.push({
      severity: "warn",
      message:
        "Run dot init to re-add firewall rules with their managed comments",
      detail:
        "ufw cannot edit a comment in place; dot deletes and re-adds the rule",
    });
  }

  return results;
});
