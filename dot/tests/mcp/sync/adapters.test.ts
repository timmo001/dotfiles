import { describe, expect, test } from "bun:test";
import {
  buildMcpEntries,
  opencodeGateKeys,
  topKeyFor,
} from "../../../src/mcp/sync/adapters.js";
import {
  renderEnvRefs,
  resolveCommand,
  resolveUrl,
  serversForHarness,
  type McpServerSpec,
  type McpSyncSpec,
} from "../../../src/mcp/sync/spec.js";

const local: McpServerSpec = {
  name: "local",
  type: "local",
  command: ["bunx", "local-mcp"],
  env: { TOKEN: "prefix-{env:API_TOKEN}-{env:SUFFIX}" },
  gated: true,
  enabled: { opencode: true, cursor: true, vscode: true, copilot: true },
  overrides: { vscode: { command: ["node", "server.js"] } },
};

const remote: McpServerSpec = {
  name: "remote",
  type: "remote",
  url: "https://example.com/mcp",
  headers: { Authorization: "Bearer {env:API_TOKEN}" },
  oauth: false,
  gated: false,
  enabled: { opencode: false, vscode: true, copilot: true },
  overrides: { copilot: { url: "https://copilot.example.com/mcp" } },
};

const spec: McpSyncSpec = { servers: [local, remote] };

describe("MCP spec helpers", () => {
  test("filters enabled servers and applies command and URL overrides", () => {
    expect(serversForHarness(spec, "cursor")).toEqual([local]);
    expect(resolveCommand(local, "vscode")).toEqual(["node", "server.js"]);
    expect(resolveCommand(local, "cursor")).toEqual(["bunx", "local-mcp"]);
    expect(resolveUrl(remote, "copilot")).toBe(
      "https://copilot.example.com/mcp",
    );
  });

  test.each([
    ["brace-env", "a{env:TOKEN}b"],
    ["dollar-brace-env", "a${env:TOKEN}b"],
    ["dollar-brace", "a${TOKEN}b"],
    ["dollar", "a$TOKENb"],
  ] as const)("renders %s environment references", (style, expected) => {
    expect(renderEnvRefs("a{env:TOKEN}b", style)).toBe(expected);
    expect(renderEnvRefs("{env:1INVALID}", style)).toBe("{env:1INVALID}");
  });
});

describe("MCP adapters", () => {
  test.each([
    ["opencode", "mcp"],
    ["cursor", "mcpServers"],
    ["vscode", "servers"],
    ["copilot", "mcpServers"],
  ] as const)("uses the %s top-level key", (harness, expected) => {
    expect(topKeyFor(harness)).toBe(expected);
  });

  test("keeps the full OpenCode catalogue with explicit enabled flags", () => {
    expect(buildMcpEntries(spec, "opencode")).toEqual({
      local: {
        type: "local",
        command: ["bunx", "local-mcp"],
        env: { TOKEN: "prefix-{env:API_TOKEN}-{env:SUFFIX}" },
        enabled: true,
      },
      remote: {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
        headers: { Authorization: "Bearer {env:API_TOKEN}" },
        enabled: false,
      },
    });
  });

  test("renders Cursor local entries and omits disabled servers", () => {
    expect(buildMcpEntries(spec, "cursor")).toEqual({
      local: {
        command: "bunx",
        args: ["local-mcp"],
        env: { TOKEN: "prefix-${env:API_TOKEN}-${env:SUFFIX}" },
      },
    });
  });

  test("renders VS Code transport types and command overrides", () => {
    expect(buildMcpEntries(spec, "vscode")).toEqual({
      local: {
        type: "stdio",
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "prefix-${env:API_TOKEN}-${env:SUFFIX}" },
      },
      remote: {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${env:API_TOKEN}" },
      },
    });
  });

  test("renders Copilot tools, environment syntax, and URL overrides", () => {
    expect(buildMcpEntries(spec, "copilot")).toEqual({
      local: {
        type: "local",
        command: "bunx",
        args: ["local-mcp"],
        env: { TOKEN: "prefix-${API_TOKEN}-${SUFFIX}" },
        tools: ["*"],
      },
      remote: {
        type: "http",
        url: "https://copilot.example.com/mcp",
        headers: { Authorization: "Bearer ${API_TOKEN}" },
        tools: ["*"],
      },
    });
  });

  test("returns ordered gates only for gated OpenCode servers", () => {
    expect(
      opencodeGateKeys({
        servers: [
          local,
          remote,
          { ...remote, name: "gated-disabled", gated: true },
          {
            ...remote,
            name: "gated-enabled",
            gated: true,
            enabled: { opencode: true },
          },
        ],
      }),
    ).toEqual(["local*", "gated-enabled*"]);
  });
});
