import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect } from "../../agents/.config/opencode/plugins-v2/node_modules/effect/dist/index.js";

const root = resolve(import.meta.dir, "../..");
const v1 = resolve(root, "agents/.config/opencode/plugins");
const v2 = resolve(root, "agents/.config/opencode/plugins-v2");

const migrated = [
  "branch-context",
  "context-capture",
  "context-zone-warning",
  "env-protection",
  "generated-artifact-guard",
  "notes-guard",
  "notification",
  "pitchfork-dev-server-guard",
  "readonly-subagent-shell-guard",
  "repo-notes",
  "subagent-chrome-devtools-guard",
  "stack-context",
  "workflow-manifest",
] as const;

describe("OpenCode V1/V2 plugin migration", () => {
  for (const name of migrated) {
    test(`${name} keeps V1 and Effect implementations`, async () => {
      const [legacy, effect] = await Promise.all([
        readFile(resolve(v1, `${name}.ts`), "utf8"),
        readFile(resolve(v2, `${name}.ts`), "utf8"),
      ]);
      expect(legacy).toContain("@opencode-ai/plugin");
      expect(legacy).not.toContain("@opencode-ai/plugin/effect");
      expect(legacy).not.toContain("Plugin.define");
      expect(effect).toContain('from "@opencode-ai/plugin/effect"');
      expect(effect).toContain(`id: "${name}"`);
      expect(effect).toContain("effect:");
    });
  }

  test("Effect modules import with the pinned plugin packages", async () => {
    const packageJson = await readFile(resolve(v2, "package.json"), "utf8");
    expect(packageJson).toContain('"@opencode-ai/plugin": "0.0.0-beta-17823"');
    expect(packageJson).toContain('"effect": "4.0.0-rc.110"');

    for (const name of migrated) {
      const plugin = (await import(resolve(v2, `${name}.ts`))).default;
      expect(plugin.id).toBe(name);
      expect(plugin).toHaveProperty("effect");
    }
  });

  test("repo-notes fails open for session lookup and notes failures", async () => {
    const { collectRepoNoteContext } = await import(resolve(v2, "repo-notes.ts"));
    const lookupWarning = await Effect.runPromise(
      collectRepoNoteContext(
        "notes-list",
        Effect.fail(new Error("session unavailable")),
      ),
    );
    expect(lookupWarning).toContain("<repo-note-context>");
    expect(lookupWarning).toContain("session unavailable");

    const processWarning = await Effect.runPromise(
      collectRepoNoteContext(
        "notes-list",
        Effect.succeed("/repo"),
        () => Promise.reject(new Error("notes unavailable")),
      ),
    );
    expect(processWarning).toContain("<repo-note-context>");
    expect(processWarning).toContain("notes unavailable");
  });

  test("stack-context warns for explicit parse failures and skips automatic absence", async () => {
    const { stackContextFromOutput } = await import(resolve(v2, "stack-context.ts"));
    const renderer = {
      parseStackContextJSON: () => null,
      isEmptyStackContext: () => true,
      renderStackContext: () => "rendered",
    };
    expect(stackContextFromOutput("not-json", true, renderer)).toContain(
      "could not parse",
    );
    expect(stackContextFromOutput("not-json", false, renderer)).toBeUndefined();

    const emptyRenderer = { ...renderer, parseStackContextJSON: () => ({}) };
    expect(stackContextFromOutput("{}", false, emptyRenderer)).toBeUndefined();
    expect(stackContextFromOutput("{}", true, emptyRenderer)).toBe("rendered");
  });

  test("Effect plugins import render helpers from lib, not flattened V1 plugin paths", async () => {
    const { readdir } = await import("node:fs/promises");
    const pluginFiles = (await readdir(v2)).filter((name) => name.endsWith(".ts"));
    for (const name of pluginFiles) {
      const source = await readFile(resolve(v2, name), "utf8");
      expect(source).not.toContain("../plugins/");
    }
  });

  test("v2 MCP transforms lack the location contract required by mcp-repo-gate", async () => {
    const mcpTypes = await readFile(
      resolve(v2, "node_modules/@opencode-ai/plugin/dist/effect/mcp.d.ts"),
      "utf8",
    );
    expect(mcpTypes).toContain("readonly transform: Transform<MCPDraft>");
    expect(mcpTypes).not.toMatch(/session|project|directory|location/i);
    expect(await Bun.file(resolve(v2, "mcp-repo-gate.ts")).exists()).toBeFalse();
  });

  test("v2 sessions lack the traversal contract required by commit-context", async () => {
    const sessionTypes = await readFile(
      resolve(v2, "node_modules/@opencode-ai/plugin/dist/effect/session.d.ts"),
      "utf8",
    );
    expect(sessionTypes).toContain("type SessionDomain = Pick<");
    expect(sessionTypes).not.toContain('"messages"');
    expect(sessionTypes).not.toContain('"children"');
    expect(await Bun.file(resolve(v2, "commit-context.ts")).exists()).toBeFalse();
  });

  test("TUI plugins retain separate V1 and V2 implementations", async () => {
    for (const name of ["dot-git-diff", "lazygit"]) {
      const [legacy, current] = await Promise.all([
        readFile(resolve(v1, `tui-${name}.ts`), "utf8"),
        readFile(resolve(v2, "tui", `${name}.ts`), "utf8"),
      ]);
      expect(legacy).toContain("TuiPlugin");
      expect(current).toContain("Plugin.Definition");
    }
  });
});
