import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadMcpConfig } from "../../../src/mcp/sync/loadSpec.js";

const tempRoots: string[] = [];

function configPath(contents?: string): string {
  const root = mkdtempSync(join(tmpdir(), "dot-mcp-config-"));
  const filePath = join(root, "mcp.yml");
  tempRoots.push(root);
  if (contents !== undefined) writeFileSync(filePath, contents);
  return filePath;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("loadMcpConfig", () => {
  test("reports a missing config without throwing", () => {
    const filePath = configPath();

    expect(loadMcpConfig(filePath)).toMatchObject({
      filePath,
      present: false,
      valid: false,
      spec: { servers: [] },
      diagnostics: [expect.stringContaining("Missing private MCP config")],
    });
  });

  test("loads and normalises local and remote servers", () => {
    const filePath = configPath(`schema_version: 1
servers:
  - name: " local-server "
    type: local
    command: [bunx, local-mcp]
    env:
      TOKEN: "{env:LOCAL_TOKEN}"
    gated: true
    enabled:
      opencode: true
      cursor: false
    overrides:
      vscode:
        command: [node, alternate.js]
  - name: remote-server
    type: remote
    url: " https://example.com/mcp "
    headers:
      Authorization: "Bearer {env:API_TOKEN}"
    oauth: false
    gated: false
    enabled:
      opencode: true
      copilot: true
    overrides:
      copilot:
        url: https://copilot.example.com/mcp
`);

    const config = loadMcpConfig(filePath);

    expect(config.valid).toBe(true);
    expect(config.diagnostics).toEqual([]);
    expect(config.spec.servers).toEqual([
      {
        name: "local-server",
        type: "local",
        command: ["bunx", "local-mcp"],
        env: { TOKEN: "{env:LOCAL_TOKEN}" },
        gated: true,
        enabled: { opencode: true, cursor: false },
        overrides: { vscode: { command: ["node", "alternate.js"] } },
      },
      {
        name: "remote-server",
        type: "remote",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer {env:API_TOKEN}" },
        oauth: false,
        gated: false,
        enabled: { opencode: true, copilot: true },
        overrides: {
          copilot: { url: "https://copilot.example.com/mcp" },
        },
      },
    ]);
  });

  test("rejects unknown keys, invalid harnesses, and malformed values", () => {
    const filePath = configPath(`schema_version: 2
unexpected: true
servers:
  - name: broken
    type: local
    url: 42
    headers: []
    env:
      TOKEN: false
    oauth: disabled
    gated: yes
    enabled:
      gemini: true
      cursor: yes
    overrides:
      cursor:
        unexpected: true
        command: [node, 42]
      claude: {}
`);

    const config = loadMcpConfig(filePath);

    expect(config.valid).toBe(false);
    expect(config.spec).toEqual({ servers: [] });
    expect(config.diagnostics).toEqual(
      expect.arrayContaining([
        "root.unexpected is not supported",
        "root.schema_version must be 1",
        "root.servers[0].url must be a non-empty string",
        "root.servers[0].headers must be an object of strings",
        "root.servers[0].env.TOKEN must be a string",
        "root.servers[0].oauth must be true or false",
        "root.servers[0].gated must be true or false",
        "root.servers[0].enabled.gemini is not an active harness",
        "root.servers[0].enabled.cursor must be true or false",
        "root.servers[0].overrides.cursor.unexpected is not supported",
        "root.servers[0].overrides.cursor.command must be an array of strings",
        "root.servers[0].overrides.claude is not an active harness",
        "root.servers[0].command is required for local servers",
      ]),
    );
  });

  test("rejects missing transport fields and duplicate names atomically", () => {
    const filePath = configPath(`schema_version: 1
servers:
  - name: duplicate
    type: local
    command: [one]
    gated: false
    enabled: {}
  - name: duplicate
    type: remote
    gated: false
    enabled: {}
`);

    const config = loadMcpConfig(filePath);

    expect(config.valid).toBe(false);
    expect(config.spec.servers).toEqual([]);
    expect(config.diagnostics).toEqual(
      expect.arrayContaining([
        "root.servers[1].url is required for remote servers",
        "Duplicate server name: duplicate",
      ]),
    );
  });

  test("turns malformed YAML into a diagnostic", () => {
    const config = loadMcpConfig(configPath("servers: [unterminated"));

    expect(config).toMatchObject({
      present: true,
      valid: false,
      spec: { servers: [] },
      diagnostics: [
        expect.stringContaining("Could not read private MCP config"),
      ],
    });
  });
});
