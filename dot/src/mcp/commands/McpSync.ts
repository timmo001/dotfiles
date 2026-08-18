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
import { Effect, Schema } from "effect";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { Config } from "../../services/Config.js";
import { OutputLog } from "../../services/OutputLog.js";
import { displayPath } from "../../lib/paths.js";
import {
  decodeJson,
  decodeJsonObject,
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
import {
  buildMcpEntries,
  opencodeGateKeys,
  topKeyFor,
} from "../sync/adapters.js";
import { formatJson } from "../sync/formatJson.js";

/** Relative path (under the private dotfiles repo) for each harness config. */
const HARNESS_RELATIVE_PATH = {
  opencode: join("agents", ".config", "opencode", "opencode.json"),
  cursor: join("agents", ".cursor", "mcp.json"),
  vscode: join("agents", ".config", "Code", "User", "mcp.json"),
  copilot: join("agents", ".copilot", "mcp-config.json"),
} satisfies Record<McpHarness, string>;

class McpSyncError extends Schema.TaggedErrorClass<McpSyncError>()(
  "McpSyncError",
  {
    message: Schema.String,
  },
) {}

/** Atomic JSON write: mkdir -p, write to temp, rename over destination. */
function atomicWriteJson(dest: string, value: JsonValue): void {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp.${process.pid}`;
  writeFileSync(tmp, formatJson(value), "utf-8");
  renameSync(tmp, dest);
}

/** Read an existing JSON object, or an empty object when absent. */
function readJsonObject(path: string) {
  if (!existsSync(path)) return {};
  try {
    return decodeJsonObject(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    throw new Error(`${displayPath(path)} is not a JSON object`);
  }
}

/**
 * Merge the OpenCode `tools` gate: drop any spec-managed `"<name>*"` keys, then
 * set gated servers to `false`. Non-managed tool entries are preserved.
 */
function mergeToolsGate(
  existing: { readonly [key: string]: JsonValue } | undefined,
  spec: McpSyncSpec,
) {
  const managed = new Set(spec.servers.map((server) => `${server.name}*`));
  const tools: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(existing ?? {})) {
    if (!managed.has(key)) tools[key] = value;
  }
  for (const key of opencodeGateKeys(spec)) tools[key] = false;
  return tools;
}

/** Build the full harness config object, preserving unrelated existing keys. */
function buildHarnessConfig(
  harness: McpHarness,
  path: string,
  spec: McpSyncSpec,
) {
  const existing = readJsonObject(path);
  const config: MutableJsonConfig = { ...existing };
  config[topKeyFor(harness)] = buildMcpEntries(spec, harness);
  if (harness === "opencode") {
    const tools = existing.tools;
    config.tools = mergeToolsGate(
      tools === undefined ? undefined : decodeJsonObject(tools),
      spec,
    );
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
  for (const harness of MCP_HARNESSES) {
    const dest = join(privateDotfiles, HARNESS_RELATIVE_PATH[harness]);
    const built = yield* Effect.sync(() =>
      buildHarnessConfig(harness, dest, spec),
    );
    yield* Effect.sync(() => atomicWriteJson(dest, built));
    const count = serversForHarness(spec, harness).length;
    yield* log.info(
      `${harness}: ${count} server${count === 1 ? "" : "s"} -> ${displayPath(dest)}`,
    );
  }
});
