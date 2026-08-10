import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

const INSTALL_HERDR_COMMAND = "mise install herdr";
const INSTALL_OPENCODE_INTEGRATION_COMMAND =
  "herdr integration install opencode";
const REQUIRED_LOCAL_PLUGINS = [
  "dotfiles.terminal-title",
  "dotfiles.yazi",
  "dotfiles.repository-picker",
  "dotfiles.mise-task-runner",
] as const;

/** Read enabled Herdr plugin IDs from `herdr plugin list --json`. */
export function enabledHerdrPluginIds(source: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object") return new Set();

    const result = (parsed as Record<string, unknown>).result;
    if (!result || typeof result !== "object") return new Set();

    const plugins = (result as Record<string, unknown>).plugins;
    if (!Array.isArray(plugins)) return new Set();

    return new Set(
      plugins.flatMap((plugin) => {
        if (!plugin || typeof plugin !== "object") return [];
        const record = plugin as Record<string, unknown>;
        return record.enabled === true && typeof record.plugin_id === "string"
          ? [record.plugin_id]
          : [];
      }),
    );
  } catch {
    return new Set();
  }
}

/** Verify Herdr and its OpenCode integration are installed. */
export const checkHerdr = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  if ((yield* executor.exitCode("which", ["herdr"])) !== 0) {
    return [
      {
        severity: "warn",
        message: "Herdr is missing",
        detail: `Run ${INSTALL_HERDR_COMMAND}`,
      },
    ] satisfies CheckResult[];
  }

  const status = yield* executor
    .run("herdr", ["integration", "status"])
    .pipe(Effect.orElseSucceed(() => ""));
  const opencodeStatus = status
    .split("\n")
    .find((line) => line.startsWith("opencode:"));

  const results: CheckResult[] = [];
  if (opencodeStatus?.includes("current")) {
    results.push({
      severity: "ok",
      message: "Herdr OpenCode integration is installed",
    });
  } else {
    results.push({
      severity: "warn",
      message: "Herdr OpenCode integration is missing",
      detail: `Run ${INSTALL_OPENCODE_INTEGRATION_COMMAND}`,
    });
  }

  const plugins = enabledHerdrPluginIds(
    yield* executor
      .run("herdr", ["plugin", "list", "--json"])
      .pipe(Effect.orElseSucceed(() => "")),
  );
  const missingPlugins = REQUIRED_LOCAL_PLUGINS.filter(
    (plugin) => !plugins.has(plugin),
  );
  if (missingPlugins.length === 0) {
    results.push({
      severity: "ok",
      message: "Herdr local plugins are enabled",
    });
  } else {
    results.push({
      severity: "warn",
      message: `Herdr local plugins are missing: ${missingPlugins.join(", ")}`,
      detail: "Run dot update",
    });
  }

  return results;
});
