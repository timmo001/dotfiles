import { afterEach, expect, test } from "bun:test";
import { Effect, Layer } from "../../dot/node_modules/effect/dist/index.js";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config } from "../../dot/src/services/Config.js";
import { CommandExecutor } from "../../dot/src/services/CommandExecutor.js";
import { OutputLog } from "../../dot/src/services/OutputLog.js";
import { parseDotGitConfigText } from "../../dot/src/services/GitConfig.js";
import { loadMcpConfig } from "../../dot/src/mcp/sync/loadSpec.js";
import { syncRepoMcpConfigs } from "../../dot/src/mcp/sync/repositories.js";
import { mcpSync } from "../../dot/src/mcp/commands/McpSync.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "dot-mcp-"));
  directories.push(directory);
  expect(Bun.spawnSync(["git", "init", "-q", directory]).exitCode).toBe(0);
  const target = join(directory, ".opencode/opencode.jsonc");
  const stateDir = join(directory, "state");

  const config = (enabled: boolean) => parseDotGitConfigText(`
schema_version: 2
repositories:
  - name: Fixture
    path: ${directory}
    github: example/fixture
    opencode_mcp: ${enabled ? "\n      - browser" : "[]"}
    activity:
      enabled: false
      schedule: '* * * * *'
    notifications:
      enabled: false
      schedule: '* * * * *'
      bar:
        ignore_bot_activity: false
`, "fixture.yml");

  const specFile = join(directory, "mcp.yml");
  writeFileSync(specFile, `
schema_version: 1
servers:
  - name: browser
    type: local
    command:
      - node
      - fixture.js
    env:
      TOKEN: '{env:TEST_TOKEN}'
    gated: false
    enabled:
      opencode: false
  - name: docs
    type: remote
    url: https://example.com/mcp
    oauth:
      client_id: fixture
      client_secret: '{env:TEST_SECRET}'
      callback_port: 19876
      redirect_uri: http://127.0.0.1:19876/callback
    gated: true
    enabled:
      opencode: true
`);
  const mcpConfig = loadMcpConfig(specFile);

  const sync = (enabled: boolean) => Effect.runPromise(syncRepoMcpConfigs.pipe(
    Effect.provide(CommandExecutor.layer),
    Effect.provide(Layer.mock(Config, { gitConfig: config(enabled), mcpConfig, stateDir })),
    Effect.provide(Layer.mock(OutputLog, { info: () => Effect.void, warn: () => Effect.void })),
  ));

  const syncGlobal = () => Effect.runPromise(mcpSync.pipe(
    Effect.provide(CommandExecutor.layer),
    Effect.provide(Layer.mock(Config, {
      gitConfig: config(true), mcpConfig, stateDir,
      canUsePrivate: true, privateDotfiles: directory,
    })),
    Effect.provide(Layer.mock(OutputLog, {
      section: () => Effect.void, info: () => Effect.void, warn: () => Effect.void,
    })),
  ));

  return { directory, target, sync, syncGlobal };
}

test("repository opt-ins are private, idempotent and removed when deselected", async () => {
  const { directory, target, sync } = fixture();
  writeFileSync(join(directory, "opencode.json"), '{"model":"keep/me"}\n');
  await sync(true);
  const content = readFileSync(target, "utf8");
  const parsed = JSON.parse(content.slice(content.indexOf("\n") + 1));
  expect(parsed.mcp.servers.browser.disabled).toBe(false);
  expect(parsed.mcp.servers.browser.command).toEqual(["node", "fixture.js"]);
  expect(Bun.spawnSync(["git", "-C", directory, "check-ignore", "-q", ".opencode/opencode.jsonc"]).exitCode).toBe(0);
  await sync(true);
  expect(readFileSync(target, "utf8")).toBe(content);
  await sync(false);
  expect(existsSync(target)).toBe(false);
  expect(readFileSync(join(directory, "opencode.json"), "utf8")).toBe('{"model":"keep/me"}\n');
});

test("repository sync preserves an existing user-owned config", async () => {
  const { target, directory, sync } = fixture();
  mkdirSync(join(directory, ".opencode"));
  writeFileSync(target, '{"model":"keep/me"}\n');
  await expect(sync(true)).rejects.toThrow("Not a dot-managed file");
  expect(readFileSync(target, "utf8")).toBe('{"model":"keep/me"}\n');
});

test("global MCP sync repairs V1 output and stays V2 on repeated syncs", async () => {
  const { directory, target, syncGlobal } = fixture();
  const global = join(directory, "agents/.config/opencode/opencode.json");
  mkdirSync(join(directory, "agents/.config/opencode"), { recursive: true });
  writeFileSync(global, JSON.stringify({
    model: "keep/me",
    mcp: { browser: { type: "local", command: ["old"], enabled: true } },
    permissions: [{ action: "shell", resource: "*", effect: "ask" }],
    tools: { "docs*": false, websearch: false },
  }));

  await syncGlobal();
  const config = JSON.parse(readFileSync(global, "utf8"));
  expect(config.model).toBe("keep/me");
  expect(config).not.toHaveProperty("tools");
  expect(Object.keys(config.mcp)).toEqual(["servers"]);
  expect(config.mcp.servers.browser).toEqual({
    type: "local", command: ["node", "fixture.js"],
    environment: { TOKEN: "{env:TEST_TOKEN}" }, disabled: true,
  });
  expect(config.mcp.servers.docs).toEqual({
    type: "remote", url: "https://example.com/mcp", disabled: false,
    oauth: {
      client_id: "fixture", client_secret: "{env:TEST_SECRET}",
      callback_port: 19876, redirect_uri: "http://127.0.0.1:19876/callback",
    },
  });
  expect(config.permissions).toEqual([
    { action: "websearch", resource: "*", effect: "deny" },
    { action: "shell", resource: "*", effect: "ask" },
    { action: "docs_*", resource: "*", effect: "deny" },
  ]);
  const repo = readFileSync(target, "utf8");
  expect(JSON.parse(repo.slice(repo.indexOf("\n") + 1)).mcp.servers.browser).toEqual({
    ...config.mcp.servers.browser, disabled: false,
  });

  config.mcp.timeout = { startup: 45000 };
  writeFileSync(global, JSON.stringify(config));
  await syncGlobal();
  const native = readFileSync(global, "utf8");
  expect(JSON.parse(native)).toEqual(config);
  await syncGlobal();
  expect(readFileSync(global, "utf8")).toBe(native);
});
