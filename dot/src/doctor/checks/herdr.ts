import { Effect, Schema } from "effect";
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
const HerdrPluginList = Schema.Struct({
  result: Schema.Struct({
    plugins: Schema.Array(
      Schema.Struct({
        plugin_id: Schema.optional(Schema.String),
        enabled: Schema.Boolean,
      }),
    ),
  }),
});

/** Read enabled Herdr plugin IDs from `herdr plugin list --json`. */
export function enabledHerdrPluginIds(source: string): ReadonlySet<string> {
  try {
    const { plugins } = Schema.decodeUnknownSync(HerdrPluginList)(
      JSON.parse(source),
    ).result;
    return new Set(
      plugins.flatMap((plugin) =>
        plugin.enabled && plugin.plugin_id ? [plugin.plugin_id] : [],
      ),
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
