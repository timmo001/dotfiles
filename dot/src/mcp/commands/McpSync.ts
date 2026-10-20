/**
 * @file `dot mcp sync` native command handler.
 *
 * Reads the private canonical MCP spec (via {@link Config}) and regenerates each
 * file-based harness's native config in the stowed private source tree, then
 * syncs Claude Code's user scope through its CLI, so a single spec edit keeps
 * OpenCode, Cursor, VS Code, Copilot, and Claude Code aligned. Gemini is a
 * documented stub and is not generated. Pure shaping lives
 * in the sync adapters; this orchestrator owns IO and logging, mirroring
 * {@link file://./../../commands/AgentsSync.ts}.
 */
import { Effect, FileSystem, Option, Schema } from "effect";
import { join } from "path";
import { writeFileAtomic } from "../../lib/atomicWrite.js";
import { Config } from "../../services/Config.js";
import { OutputLog } from "../../services/OutputLog.js";
import { CONFIG_DIR, displayPath } from "../../lib/paths.js";
import { readTextOrNull } from "../../lib/fsProbe.js";
import { readPrivateSelection } from "../../lib/privateSelection.js";
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
  MCP_FILE_HARNESSES,
  serversForHarness,
  type McpFileHarness,
  type McpSyncSpec,
} from "../sync/spec.js";
import { buildMcpEntries, topKeyFor } from "../sync/adapters.js";
import { syncClaudeMcp } from "../sync/claude.js";
import { formatJson } from "../sync/formatJson.js";
import { syncRepoMcpConfigs } from "../sync/repositories.js";

/** Relative path (under the private dotfiles repo) for each harness config. */
const HARNESS_RELATIVE_PATH = {
  opencode: join("agents", ".config", "opencode", "opencode.json"),
  cursor: join("agents", ".cursor", "mcp.json"),
  vscode: join("agents", ".config", "Code", "User", "mcp.json"),
  copilot: join("agents", ".copilot", "mcp-config.json"),
} satisfies Record<McpFileHarness, string>;

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
  harness: McpFileHarness,
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

/** OpenCode's untracked global config layer, loaded after `opencode.json`. */
const OPENCODE_MACHINE_CONFIG = join(CONFIG_DIR, "opencode", "opencode.jsonc");

/**
 * Keep the MCP servers `.dot-private.yml` excludes off this machine without
 * touching the shared generated configs: OpenCode gets them as disabled in its
 * untracked `opencode.jsonc` layer, and the returned spec, used for Claude
 * Code, disables them. Without the file, the spec is returned unchanged and
 * `opencode.jsonc` is left alone.
 */
const syncMachineExcludes = Effect.fn("McpSync.machineExcludes")(function* (
  spec: McpSyncSpec,
  publicDotfiles: string,
) {
  const log = yield* OutputLog;
  const selection = yield* readPrivateSelection(publicDotfiles);

  if (selection === null) return spec;

  const exclude = selection.mcpExclude;

  for (const name of exclude) {
    if (!spec.servers.some((server) => server.name === name))
      yield* log.warn(`Unknown MCP server in .dot-private.yml: ${name}`);
  }

  const machineSpec: McpSyncSpec = {
    servers: spec.servers.map((server) =>
      exclude.has(server.name) ? { ...server, enabled: {} } : server,
    ),
  };

  const text = yield* readTextOrNull(OPENCODE_MACHINE_CONFIG);

  const existing = yield* Effect.try(() =>
    decodeJsonObject(text === null ? {} : Bun.JSONC.parse(text)),
  ).pipe(Effect.option);

  if (Option.isNone(existing)) {
    yield* log.warn(
      `Skipped excluding MCP servers: ${displayPath(OPENCODE_MACHINE_CONFIG)} is not a JSON object`,
    );

    return machineSpec;
  }

  const servers = Object.fromEntries(
    Object.entries(buildMcpEntries(machineSpec, "opencode")).filter(([name]) =>
      exclude.has(name),
    ),
  );

  const count = Object.keys(servers).length;

  const layer: MutableJsonConfig = {
    $schema: "https://opencode.ai/config.json",
    ...existing.value,
  };

  if (count > 0) layer.mcp = { servers };
  else Reflect.deleteProperty(layer, "mcp");

  yield* Effect.sync(() =>
    writeFileAtomic(OPENCODE_MACHINE_CONFIG, formatJson(decodeJson(layer)), {
      createDirectory: true,
    }),
  );

  if (count > 0) {
    const style = cliStyler();

    yield* log.success(
      `${style.accent("opencode")} ${plural(count, "server")} excluded ${style.dim(displayPath(OPENCODE_MACHINE_CONFIG))}`,
    );
  }

  return machineSpec;
});

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

  for (const harness of MCP_FILE_HARNESSES) {
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

  const claude = yield* syncClaudeMcp(
    yield* syncMachineExcludes(spec, config.publicDotfiles),
  );

  if (claude === null) {
    yield* log.info("Skipped claude (CLI not installed)");
  } else {
    yield* log.success(
      `${style.accent("claude")} ${plural(claude.enabled, "server")} ${style.dim(
        `user scope (${claude.added} added, ${claude.removed} removed)`,
      )}`,
    );
  }
});
