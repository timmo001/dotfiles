/**
 * @file `dot mcp-sync` native command handler.
 *
 * Reads the private canonical MCP spec (via {@link Config}) and regenerates each
 * active harness's native config in the stowed private source tree, so a single
 * spec edit keeps OpenCode, Cursor, VS Code, and Copilot aligned. Gemini and
 * Claude Code are documented stubs and are not generated. Pure shaping lives
 * in the sync adapters; this orchestrator owns IO and logging, mirroring
 * {@link file://./../../commands/AgentsSync.ts}.
 */
import { Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { writeFileAtomic } from "../../lib/atomicWrite.js";
import { Config } from "../../services/Config.js";
import { OutputLog } from "../../services/OutputLog.js";
import { displayPath } from "../../lib/paths.js";
import { cliStyler } from "../../lib/ansi.js";
import { plural } from "../../lib/runSummary.js";
import {
  decodeJson,
  decodeJsonObject,
  isString,
  type JsonValue,
} from "../../lib/schema.js";

interface MutableJsonConfig {
  [key: string]: JsonValue;
}

import {
  MCP_HARNESSES,
  serversForHarness,
  type McpHarness,
  type McpSyncSpec,
} from "../sync/spec.js";
import { buildMcpEntries, topKeyFor } from "../sync/adapters.js";
import { formatJson } from "../sync/formatJson.js";
import { syncRepoMcpConfigs } from "../sync/repositories.js";

/** Relative path (under the private dotfiles repo) for each harness config. */
const HARNESS_RELATIVE_PATH = {
  opencode: join("agents", ".config", "opencode", "opencode.json"),
  cursor: join("agents", ".cursor", "mcp.json"),
  vscode: join("agents", ".config", "Code", "User", "mcp.json"),
  copilot: join("agents", ".copilot", "mcp-config.json"),
} satisfies Record<McpHarness, string>;

class McpSyncError extends Schema.TaggedError<McpSyncError>()("McpSyncError", {
  message: Schema.String,
}) {}

/** Read an existing JSON object, or an empty object when absent. */
const readJsonObject = Effect.fn("McpSync.readJsonObject")(function* (
  path: string,
) {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false))))
    return {};

  const text = yield* fs.readFileString(path).pipe(Effect.orDie);

  return yield* Effect.try({
    try: () => decodeJsonObject(JSON.parse(text)),
    catch: () =>
      new McpSyncError({
        message: `${displayPath(path)} is not a JSON object`,
      }),
  }).pipe(Effect.orDie);
});

/**
 * Refresh spec-managed MCP permission gates and migrate legacy tool entries.
 */
function mergePermissions(existing: MutableJsonConfig, spec: McpSyncSpec) {
  const managed = new Set(
    spec.servers.map(
      (server) => `${server.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_*`,
    ),
  );

  const legacyManaged = new Set(
    spec.servers.map((server) => `${server.name}*`),
  );

  const permissions: JsonValue[] = [];

  const actions = new Map([
    ["bash", "shell"],
    ["task", "subagent"],
    ["write", "edit"],
    ["patch", "edit"],
  ]);

  for (const [key, enabled] of Object.entries(
    Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Boolean))(
      existing.tools ?? {},
    ),
  )) {
    if (!legacyManaged.has(key)) {
      permissions.push({
        action: actions.get(key) ?? key,
        resource: "*",
        effect: enabled ? "allow" : "deny",
      });
    }
  }

  permissions.push(
    ...Schema.decodeUnknownSync(
      Schema.Array(Schema.Record(Schema.String, Schema.Json)),
    )(existing.permissions ?? []).filter(
      (rule) =>
        !(
          isString(rule.action) &&
          managed.has(rule.action) &&
          rule.resource === "*" &&
          rule.effect === "deny"
        ),
    ),
  );

  for (const server of spec.servers) {
    if (server.gated && server.enabled.opencode === true) {
      permissions.push({
        action: `${server.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_*`,
        resource: "*",
        effect: "deny",
      });
    }
  }

  return permissions;
}

/** Build the full harness config object, preserving unrelated existing keys. */
function buildHarnessConfig(
  harness: McpHarness,
  existing: MutableJsonConfig,
  spec: McpSyncSpec,
) {
  const config: MutableJsonConfig = { ...existing };

  if (harness === "opencode") {
    const mcp = decodeJsonObject(existing.mcp ?? {});

    const nativeMcp: MutableJsonConfig = {
      servers: buildMcpEntries(spec, harness),
    };

    if (mcp.timeout !== undefined) nativeMcp.timeout = mcp.timeout;
    config.mcp = nativeMcp;

    const permissions = mergePermissions(existing, spec);

    if (existing.permissions !== undefined || permissions.length > 0)
      config.permissions = permissions;
    Reflect.deleteProperty(config, "tools");
  } else {
    config[topKeyFor(harness)] = buildMcpEntries(spec, harness);
  }

  return decodeJson(config);
}

/**
 * Regenerate every active harness's MCP config from the private spec.
 *
 * Skips gracefully when private dotfiles are unavailable or the spec is missing;
 * fails with diagnostics when the spec is present but invalid.
 */
export const mcpSync = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;

  yield* log.section("MCP Config Sync");

  const { canUsePrivate, privateDotfiles, mcpConfig } = config;

  if (!canUsePrivate || privateDotfiles === null) {
    yield* log.warn(`Skipped: ${config.privateReason}`);

    return;
  }

  if (!mcpConfig.present) {
    yield* log.warn(
      `Skipped (missing spec): ${displayPath(mcpConfig.filePath)}`,
    );

    return;
  }

  if (!mcpConfig.valid) {
    yield* log.error(`Invalid spec: ${displayPath(mcpConfig.filePath)}`);

    for (const diagnostic of mcpConfig.diagnostics) {
      yield* log.error(`  ${diagnostic}`);
    }

    return yield* new McpSyncError({
      message: `Invalid MCP spec: ${displayPath(mcpConfig.filePath)}`,
    });
  }

  const spec = mcpConfig.spec;

  const style = cliStyler();

  yield* syncRepoMcpConfigs;

  for (const harness of MCP_HARNESSES) {
    const dest = join(privateDotfiles, HARNESS_RELATIVE_PATH[harness]);

    const existing = yield* readJsonObject(dest);

    const built = yield* Effect.sync(() =>
      buildHarnessConfig(harness, existing, spec),
    );

    yield* Effect.sync(() =>
      writeFileAtomic(dest, formatJson(built), { createDirectory: true }),
    );
    const count = serversForHarness(spec, harness).length;
    yield* log.success(
      `${style.accent(harness)} ${plural(count, "server")} ${style.dim(displayPath(dest))}`,
    );
  }
});
