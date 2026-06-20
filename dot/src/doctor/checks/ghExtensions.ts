import { Effect } from "effect";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import {
  ghExtensionsListPath,
  loadGhExtensions,
  parseInstalledGhExtensions,
} from "../../lib/ghExtensions.js";
import type { CheckResult } from "../types.js";

/** Check that configured gh CLI extensions are installed */
export const checkGhExtensions = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  const desired = loadGhExtensions(ghExtensionsListPath(config));
  if (desired.length === 0) {
    results.push({ severity: "ok", message: "No gh extensions configured" });
    return results;
  }

  if ((yield* executor.exitCode("which", ["gh"])) !== 0) {
    results.push({
      severity: "warn",
      message: `gh is missing; cannot verify ${desired.length} configured extensions`,
    });
    return results;
  }

  const listed = yield* executor
    .run("gh", ["extension", "list"])
    .pipe(Effect.catch(() => Effect.succeed("")));
  const installed = parseInstalledGhExtensions(listed);

  const missing: string[] = [];
  for (const repo of desired) {
    if (installed.has(repo.toLowerCase())) {
      results.push({ severity: "ok", message: `${repo} is installed` });
    } else {
      results.push({ severity: "warn", message: `${repo} is missing` });
      missing.push(repo);
    }
  }

  if (missing.length > 0) {
    results.push({
      severity: "warn",
      message: `${missing.length} gh extension(s) missing`,
      detail: `Run dot init, or: ${missing
        .map((repo) => `gh extension install ${repo}`)
        .join("; ")}`,
    });
  }

  return results;
});
