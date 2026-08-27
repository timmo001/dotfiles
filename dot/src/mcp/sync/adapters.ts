/**
 * @file Per-harness MCP config adapters.
 *
 * Pure transforms from the canonical {@link McpSyncSpec} to each active
 * harness's native entry shape. File IO, path resolution, and merging live in
 * the `mcp-sync` command; this module only shapes objects so it stays testable.
 */
import {
  renderEnvRefs,
  resolveCommand,
  resolveUrl,
  serverEnabledFor,
  serversForHarness,
  type McpHarness,
  type McpServerSpec,
  type McpSyncSpec,
} from "./spec.js";
import type { JsonObject, JsonValue } from "../../lib/schema.js";

interface MutableJsonObject {
  [key: string]: JsonValue;
}

/** Env interpolation style per active harness. */
const ENV_STYLE = {
  opencode: "brace-env",
  cursor: "dollar-brace-env",
  vscode: "dollar-brace-env",
  copilot: "dollar-brace",
} as const satisfies Record<
  McpHarness,
  "brace-env" | "dollar-brace-env" | "dollar-brace" | "dollar"
>;

/** Top-level config key that holds MCP servers for each harness. */
export function topKeyFor(harness: McpHarness): string {
  switch (harness) {
    case "opencode":
    case "cursor":
    case "copilot":
      return harness === "opencode" ? "mcp" : "mcpServers";
    case "vscode":
      return "servers";
  }
}

function renderHeaders(
  headers: Readonly<Record<string, string>>,
  harness: McpHarness,
): Record<string, string> {
  const style = ENV_STYLE[harness];
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      renderEnvRefs(value, style),
    ]),
  );
}

function renderEnv(
  env: Readonly<Record<string, string>>,
  harness: McpHarness,
): Record<string, string> {
  const style = ENV_STYLE[harness];
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      renderEnvRefs(value, style),
    ]),
  );
}

function renderOpencodeEntry(
  server: McpServerSpec,
  enabled: boolean,
): JsonObject {
  if (server.type === "local") {
    const entry: MutableJsonObject = {
      type: "local",
      command: resolveCommand(server, "opencode") ?? [],
      enabled,
    };
    if (server.env) entry.env = renderEnv(server.env, "opencode");
    return entry;
  }
  const entry: MutableJsonObject = {
    type: "remote",
    url: resolveUrl(server, "opencode") ?? "",
    enabled,
  };
  if (server.oauth === false) entry.oauth = false;
  if (
    server.oauth !== undefined &&
    server.oauth !== true &&
    server.oauth !== false
  ) {
    const oauth: MutableJsonObject = {};
    if (server.oauth.client_id !== undefined)
      oauth.clientId = server.oauth.client_id;
    if (server.oauth.client_secret !== undefined) {
      oauth.clientSecret = renderEnvRefs(
        server.oauth.client_secret,
        ENV_STYLE.opencode,
      );
    }
    if (server.oauth.scope !== undefined) oauth.scope = server.oauth.scope;
    if (server.oauth.callback_port !== undefined)
      oauth.callbackPort = server.oauth.callback_port;
    if (server.oauth.redirect_uri !== undefined)
      oauth.redirectUri = server.oauth.redirect_uri;
    entry.oauth = oauth;
  }
  if (server.headers) entry.headers = renderHeaders(server.headers, "opencode");
  return entry;
}

function splitCommand(command: readonly string[]) {
  return { command: command[0] ?? "", args: command.slice(1) };
}

function renderCursorEntry(server: McpServerSpec): JsonObject {
  if (server.type === "local") {
    const { command, args } = splitCommand(
      resolveCommand(server, "cursor") ?? [],
    );
    const entry: MutableJsonObject = {
      command,
      args,
    };
    if (server.env) entry.env = renderEnv(server.env, "cursor");
    return entry;
  }
  const entry: MutableJsonObject = {
    type: "http",
    url: resolveUrl(server, "cursor") ?? "",
  };
  if (server.headers) entry.headers = renderHeaders(server.headers, "cursor");
  return entry;
}

function renderVscodeEntry(server: McpServerSpec): JsonObject {
  if (server.type === "local") {
    const { command, args } = splitCommand(
      resolveCommand(server, "vscode") ?? [],
    );
    const entry: MutableJsonObject = {
      type: "stdio",
      command,
      args,
    };
    if (server.env) entry.env = renderEnv(server.env, "vscode");
    return entry;
  }
  const entry: MutableJsonObject = {
    type: "http",
    url: resolveUrl(server, "vscode") ?? "",
  };
  if (server.headers) entry.headers = renderHeaders(server.headers, "vscode");
  return entry;
}

function renderCopilotEntry(server: McpServerSpec): JsonObject {
  if (server.type === "local") {
    const { command, args } = splitCommand(
      resolveCommand(server, "copilot") ?? [],
    );
    const entry: MutableJsonObject = {
      type: "local",
      command,
      args,
      tools: ["*"],
    };
    if (server.env) entry.env = renderEnv(server.env, "copilot");
    return entry;
  }
  const entry: MutableJsonObject = {
    type: "http",
    url: resolveUrl(server, "copilot") ?? "",
    tools: ["*"],
  };
  if (server.headers) entry.headers = renderHeaders(server.headers, "copilot");
  return entry;
}

function renderEntry(
  server: McpServerSpec,
  harness: Exclude<McpHarness, "opencode">,
): JsonObject {
  switch (harness) {
    case "cursor":
      return renderCursorEntry(server);
    case "vscode":
      return renderVscodeEntry(server);
    case "copilot":
      return renderCopilotEntry(server);
  }
}

/**
 * Build the harness-native MCP entry map. OpenCode receives the full catalogue
 * (every server, each with an explicit `enabled` flag); the other harnesses
 * receive only their enabled servers.
 */
export function buildMcpEntries(
  spec: McpSyncSpec,
  harness: McpHarness,
): JsonObject {
  const entries: Record<string, JsonValue> = {};
  if (harness === "opencode") {
    for (const server of spec.servers) {
      entries[server.name] = renderOpencodeEntry(
        server,
        serverEnabledFor(server, "opencode"),
      );
    }
    return entries;
  }
  for (const server of serversForHarness(spec, harness)) {
    entries[server.name] = renderEntry(server, harness);
  }
  return entries;
}

/**
 * OpenCode `tools` gate keys (`"<name>*"`) for gated servers enabled on
 * OpenCode. Each maps to `false` so the tool schemas stay out of the baseline
 * request unless an agent re-enables them.
 */
export function opencodeGateKeys(spec: McpSyncSpec): readonly string[] {
  return spec.servers
    .filter((server) => server.gated && server.enabled.opencode === true)
    .map((server) => `${server.name}*`);
}
