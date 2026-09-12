import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { Effect, FileSystem, Schema } from "../../dot/node_modules/effect/dist/index.js";
import { HerdrSdk, herdrSdkLayerFromOptions, Pane, PaneProcessInfo, Tab, Workspace } from "../../dot/node_modules/@herdr/sdk/src/index.ts";
import { openHerdrRepo, type HerdrRepoOpenOptions } from "../../dot/src/commands/HerdrRepoOpen.js";
import { CommandExecutor } from "../../dot/src/services/CommandExecutor.js";

const directory = "/fixture/repo";

const idlePane = (id = "w1:p1", tab = "w1:t1", agent: string | null = null, focused = true) => Schema.decodeUnknownSync(Pane)({
  pane_id: id, tab_id: tab, workspace_id: "w1", terminal_id: `terminal-${id}`,
  revision: 0, focused, agent_status: "idle", agent, cwd: directory,
});

const shellInfo = (id: string, process: { pid?: number; name?: string; argv?: string[]; cwd?: string } = {}) => Schema.decodeUnknownSync(PaneProcessInfo)({
  pane_id: id, shell_pid: 42, foreground_process_group_id: process.pid ?? 42,
  foreground_processes: [{ pid: 42, name: "zsh", argv: ["/usr/bin/zsh", "-l"], cwd: directory, ...process }],
});

async function launch(options: {
  request?: Partial<HerdrRepoOpenOptions>;
  panes?: Pane[];
  processInfo?: (id: string, read: number) => PaneProcessInfo;
  workspaceExists?: boolean;
} = {}) {
  const panes = options.panes ?? [idlePane()];

  const tabs = [...new Set(panes.map(pane => pane.tabId))].map((id, index) => Schema.decodeUnknownSync(Tab)({
    tab_id: id, workspace_id: "w1", label: "Shell", number: index + 1,
    pane_count: panes.filter(pane => pane.tabId === id).length, agent_status: "idle", focused: index === 0,
  }));

  const workspace = Schema.decodeUnknownSync(Workspace)({
    workspace_id: "w1", active_tab_id: "w1:t1", label: "fixture", number: 1,
    pane_count: panes.length, tab_count: tabs.length, agent_status: "idle", focused: true,
  });

  const newPane = idlePane("w1:p9", "w1:t9");

  const newTab = Schema.decodeUnknownSync(Tab)({
    tab_id: "w1:t9", workspace_id: "w1", label: "Action", number: 9,
    pane_count: 1, agent_status: "idle", focused: false,
  });

  const calls: { method: string; id?: string; input?: unknown }[] = [];
  const reads = new Map<string, number>();

  const record = <A, Input = undefined>(method: string, result: A, id?: string, input?: Input) => Effect.sync(() => {
    calls.push({ method, id, input });

    return result;
  });

  const program = Effect.gen(function* () {
    const sdk = yield* HerdrSdk;

    return yield* openHerdrRepo({ pane: false, label: "fixture", directory, tabLabel: "Action", command: "lazygit", ...options.request }, {
      foregroundClientReady: Effect.succeed(true),
    }).pipe(Effect.provideService(HerdrSdk, {
      ...sdk,
      workspaces: { ...sdk.workspaces,
        list: () => record("workspaces.list", options.workspaceExists === false ? [] : [workspace]),
        createInDirectory: (cwd, input) => record("workspaces.create", { workspace, tab: newTab, rootPane: newPane }, cwd, input),
        focus: id => record("workspaces.focus", workspace, id),
      },
      tabs: { ...sdk.tabs,
        list: () => record("tabs.list", tabs),
        create: input => record("tabs.create", { tab: newTab, rootPane: newPane }, undefined, input),
        rename: (id, label) => record("tabs.rename", newTab, id, label),
        focus: id => record("tabs.focus", newTab, id),
      },
      panes: { ...sdk.panes,
        list: () => record("panes.list", panes),
        get: id => record("panes.get", panes.find(pane => pane.id === id) ?? newPane, id),
        processInfo: id => Effect.suspend(() => {
          const read = (reads.get(id) ?? 0) + 1;
          reads.set(id, read);

          return record("panes.processInfo", options.processInfo?.(id, read) ?? shellInfo(id), id);
        }),
        split: (id, input) => record("panes.split", newPane, id, input),
        rename: (id, label) => record("panes.rename", newPane, id, label),
        sendInput: (id, input) => record("panes.sendInput", undefined, id, input),
        focus: id => record("panes.focus", newPane, id),
      },
    }));
  }).pipe(
    Effect.provide(herdrSdkLayerFromOptions({ socketPath: "/fixture/herdr.sock" })),
    Effect.provideService(CommandExecutor, CommandExecutor.of({
      run: () => Effect.die("Unexpected external command"),
      exitCode: () => Effect.die("Unexpected external command"),
      inherit: () => Effect.die("Unexpected external command"),
      stream: () => { throw new Error("Unexpected external command"); },
    })),
    Effect.provide(FileSystem.layerNoop({})),
  );

  await Effect.runPromise(program);

  return calls;
}

test("normal launches reuse the active idle shell without creating a tab or pane", async () => {
  const calls = await launch();
  expect(calls.some(call => ["tabs.create", "panes.split"].includes(call.method))).toBe(false);
  expect(calls.find(call => call.method === "panes.sendInput")).toMatchObject({ id: "w1:p1", input: { text: "lazygit", keys: ["enter"] } });
  expect(calls.at(-1)).toMatchObject({ method: "panes.focus", id: "w1:p1" });
});

test("normal launches find an idle tab when the active tab is busy", async () => {
  const calls = await launch({ panes: [idlePane(), idlePane("w1:p2", "w1:t2")], processInfo: id => shellInfo(id, id === "w1:p1" ? { pid: 99, name: "nvim", argv: ["nvim"] } : {}) });
  expect(calls.find(call => call.method === "panes.sendInput")?.id).toBe("w1:p2");
});

test.each([
  { modifiers: 0x02000000, method: "panes.split", direction: "right" },
  { modifiers: 0x08000000, method: "panes.split", direction: "down" },
  { modifiers: 0x04000000, method: "tabs.create" },
  { modifiers: 0x0e000000, method: "tabs.create" },
  { modifiers: 0x0a000000, method: "panes.split", direction: "down" },
])("explicit modifiers force placement: $modifiers", async ({ modifiers, method, direction }) => {
  const calls = await launch({ request: { modifiers } });
  expect(calls.find(call => call.method === method)).toMatchObject({ input: direction ? { direction, cwd: directory } : { cwd: directory } });
  expect(calls.some(call => call.method === "panes.processInfo")).toBe(false);
});

test("agent-idle panes are not reusable shells", async () => {
  const calls = await launch({ panes: [idlePane("w1:p1", "w1:t1", "opencode"), idlePane("w1:p2", "w1:t1", "opencode", false)] });
  expect(calls.find(call => call.method === "panes.split")).toMatchObject({ id: "w1:p1", input: { direction: "right" } });
  expect(calls.some(call => call.method === "panes.processInfo")).toBe(false);
});

test("a split tab reuses its focused idle pane and keeps the tab label", async () => {
  const calls = await launch({ panes: [idlePane("w1:p1", "w1:t1", null, false), idlePane("w1:p2", "w1:t1")] });
  expect(calls.some(call => ["tabs.create", "panes.split", "tabs.rename"].includes(call.method))).toBe(false);
  expect(calls.find(call => call.method === "panes.sendInput")?.id).toBe("w1:p2");
  expect(calls.find(call => call.method === "panes.rename")).toMatchObject({ id: "w1:p2", input: "Action" });
  expect(calls.at(-1)).toMatchObject({ method: "panes.focus", id: "w1:p2" });
});

test("the focused idle pane wins over an earlier workspace tab snapshot", async () => {
  const calls = await launch({ panes: [idlePane("w1:p1", "w1:t1", null, false), idlePane("w1:p2", "w1:t2")] });
  expect(calls.find(call => call.method === "panes.sendInput")?.id).toBe("w1:p2");
  expect(calls.at(-1)).toMatchObject({ method: "panes.focus", id: "w1:p2" });
});

test("a busy focused pane still prioritises its idle sibling over the earlier active tab", async () => {
  const calls = await launch({
    panes: [idlePane("w1:p1", "w1:t1", null, false), idlePane("w1:p2", "w1:t2", null, false), idlePane("w1:p3", "w1:t2")],
    processInfo: id => shellInfo(id, id === "w1:p3" ? { pid: 99, name: "lazygit", argv: ["lazygit"] } : {}),
  });

  expect(calls.find(call => call.method === "panes.sendInput")?.id).toBe("w1:p2");
});

test("an idle sibling wins over another tab when the focused pane and agent are busy", async () => {
  const calls = await launch({
    panes: [idlePane("w1:p1", "w1:t1", "opencode", false), idlePane("w1:p2", "w1:t1", null, false), idlePane("w1:p3", "w1:t1"), idlePane("w1:p4", "w1:t2")],
    processInfo: id => shellInfo(id, id === "w1:p3" ? { pid: 99, name: "lazygit", argv: ["lazygit"] } : {}),
  });

  expect(calls.some(call => ["tabs.create", "panes.split", "tabs.rename"].includes(call.method))).toBe(false);
  expect(calls.find(call => call.method === "panes.sendInput")?.id).toBe("w1:p2");
});

test("idle panes in other split tabs can be reused", async () => {
  const calls = await launch({ panes: [idlePane("w1:p1", "w1:t1", "opencode"), idlePane("w1:p2", "w1:t2", "opencode", false), idlePane("w1:p3", "w1:t2")] });
  expect(calls.some(call => ["tabs.create", "panes.split", "tabs.rename"].includes(call.method))).toBe(false);
  expect(calls.at(-1)).toMatchObject({ method: "panes.focus", id: "w1:p3" });
});

test("a shell that becomes busy before reuse gets a new split instead", async () => {
  const calls = await launch({ processInfo: (id, read) => shellInfo(id, read > 1 ? { pid: 99, name: "nvim", argv: ["nvim"] } : {}) });
  expect(calls.find(call => call.method === "panes.sendInput")?.id).toBe("w1:p9");
  expect(calls.some(call => call.method === "panes.split")).toBe(true);
});

test("shell scripts are not mistaken for idle interactive shells", async () => {
  const calls = await launch({ processInfo: id => shellInfo(id, { argv: ["zsh", "-c", "read value"] }) });
  expect(calls.some(call => call.method === "panes.split")).toBe(true);
});

test("reuse changes directory before evaluating the original command", async () => {
  const calls = await launch({ request: { directory: "/fixture/other's repo", command: "printf '%s' ok; pwd" } });
  expect(calls.find(call => call.method === "panes.sendInput")?.input).toEqual({ text: "cd -- '/fixture/other'\\''s repo' && eval 'printf '\\''%s'\\'' ok; pwd'", keys: ["enter"] });
});

test("a new workspace runs its first command in its initial pane", async () => {
  const calls = await launch({ workspaceExists: false, request: { modifiers: 0x04000000 } });
  expect(calls.some(call => ["tabs.create", "panes.split"].includes(call.method))).toBe(false);
  expect(calls.find(call => call.method === "panes.sendInput")?.id).toBe("w1:p9");
});

test("an explicit empty-shell action still honours Ctrl while a picker only focuses", async () => {
  expect((await launch({ request: { command: "", modifiers: 0x04000000 } })).some(call => call.method === "tabs.create")).toBe(true);
  expect((await launch({ request: { command: undefined } })).map(call => call.method)).toEqual(["workspaces.list", "workspaces.focus"]);
});

test.each([
  { pane: true, layout: "auto" as const },
  { layout: "tab" as const, modifiers: 0 },
  { pane: true, modifiers: 0 },
])("conflicting placement inputs fail before touching Herdr: %j", async request => {
  await expect(launch({ request })).rejects.toThrow("Use only one of --pane, --layout or --modifiers");
});

function qmlFunctions(file: string, names: string[]) {
  const source = readFileSync(new URL(`../../omarchy/.config/omarchy/plugins/${file}`, import.meta.url), "utf8");

  return names.map(name => {
    const body = source.match(new RegExp(`  function ${name}\\([^]*?\\n  }`))?.[0];

    if (!body) throw new Error(`Missing QML function ${name}`);

    return body;
  }).join("\n");
}

interface LaunchProcess {
  command: string[];
  running: boolean;
}

test("release preparation retains Enter/click modifiers through the agent launcher", () => {
  const agentLaunchProcess: LaunchProcess = { command: [], running: false };
  const entry = { name: "fixture", path: directory, repo: "fixture/repo", snapshot: { findings: [] } };
  runInNewContext(
    qmlFunctions("timmo.git/Service.qml", ["herdrCommand", "prepareRelease", "openAgent"]) + "\n" +
    qmlFunctions("timmo.git/Panel.qml", ["activateAction"]) +
    "\nservice = { prepareRelease, openAgent }; activateAction('agent:opencode2', 134217728);",
    {
      service: null, selectedRepo: entry, selectedRelease: entry, releaseAgentView: true, findingGroups: [],
      releaseActionError: "", releasePreparationIssue: () => "", agentLaunching: false, agentLaunchError: "",
      installedAgents: [{ command: "opencode2", label: "OpenCode", executable: "/fixture/opencode2" }],
      agentLaunchProcess,
    },
  );
  expect(agentLaunchProcess.running).toBe(true);
  expect(agentLaunchProcess.command.slice(0, 7)).toEqual(["dot", "herdr", "repo-open", "--modifiers", "134217728", "--agent-kind", "opencode"]);
  expect(agentLaunchProcess.command).toContain("--prompt");
  expect(agentLaunchProcess.command.slice(-4)).toEqual(["fixture", directory, "OpenCode", "/fixture/opencode2"]);
});

test("the updater forwards modifiers once and keeps right-click refresh", () => {
  const commands: string[] = [];
  runInNewContext(
    qmlFunctions("timmo.command/Widget.qml", ["activateCommand"]) +
    "\nactivateCommand(Qt.LeftButton, 67108864); activateCommand(Qt.RightButton, 67108864);",
    {
      Qt: { LeftButton: 1, RightButton: 2, MiddleButton: 4 },
      root: { herdrLaunch: true, onClickCmd: "dot herdr repo-open fixture /fixture Update update", onClickRightCmd: "dot updates refresh", onMiddleClickCmd: "", bar: { run: (command: string) => commands.push(command) } },
    },
  );
  expect(commands).toEqual(["dot herdr repo-open fixture /fixture Update update --modifiers 67108864", "dot updates refresh"]);
});
