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
): Record<string, unknown> {
  if (server.type === "local") {
    return {
      type: "local",
      command: resolveCommand(server, "opencode") ?? [],
      ...(server.env ? { env: renderEnv(server.env, "opencode") } : {}),
      enabled,
    };
  }
  return {
    type: "remote",
    url: resolveUrl(server, "opencode") ?? "",
    ...(server.oauth === false ? { oauth: false } : {}),
    ...(server.headers
      ? { headers: renderHeaders(server.headers, "opencode") }
      : {}),
    enabled,
  };
}

function splitCommand(command: readonly string[]): {
  readonly command: string;
  readonly args: readonly string[];
} {
  return { command: command[0] ?? "", args: command.slice(1) };
}

function renderCursorEntry(server: McpServerSpec): Record<string, unknown> {
  if (server.type === "local") {
    const { command, args } = splitCommand(
      resolveCommand(server, "cursor") ?? [],
    );
    return {
      command,
      args,
      ...(server.env ? { env: renderEnv(server.env, "cursor") } : {}),
    };
  }
  return {
    type: "http",
    url: resolveUrl(server, "cursor") ?? "",
    ...(server.headers
      ? { headers: renderHeaders(server.headers, "cursor") }
      : {}),
  };
}

function renderVscodeEntry(server: McpServerSpec): Record<string, unknown> {
  if (server.type === "local") {
    const { command, args } = splitCommand(
      resolveCommand(server, "vscode") ?? [],
    );
    return {
      type: "stdio",
      command,
      args,
      ...(server.env ? { env: renderEnv(server.env, "vscode") } : {}),
    };
  }
  return {
    type: "http",
    url: resolveUrl(server, "vscode") ?? "",
    ...(server.headers
      ? { headers: renderHeaders(server.headers, "vscode") }
      : {}),
  };
}

function renderCopilotEntry(server: McpServerSpec): Record<string, unknown> {
  if (server.type === "local") {
    const { command, args } = splitCommand(
      resolveCommand(server, "copilot") ?? [],
    );
    return {
      type: "local",
      command,
      args,
      ...(server.env ? { env: renderEnv(server.env, "copilot") } : {}),
      tools: ["*"],
    };
  }
  return {
    type: "http",
    url: resolveUrl(server, "copilot") ?? "",
    ...(server.headers
      ? { headers: renderHeaders(server.headers, "copilot") }
      : {}),
    tools: ["*"],
  };
}

function renderEntry(
  server: McpServerSpec,
  harness: Exclude<McpHarness, "opencode">,
): Record<string, unknown> {
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
): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
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
