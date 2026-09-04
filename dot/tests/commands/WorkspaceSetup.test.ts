import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  WorkspaceSetupError,
  resolveWorkspaceSetupConfig,
  validateWorkspaceSetupPreflight,
  workspaceSetup,
  type WorkspaceSetupOptions,
} from "../../src/commands/WorkspaceSetup.js";
import { STATE_DIR } from "../../src/lib/paths.js";
import {
  CommandError,
  CommandExecutor,
} from "../../src/services/CommandExecutor.js";

const roots: string[] = [];
const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const defaults: WorkspaceSetupOptions = {
  stepThrough: false,
  speedMultiplier: 1.8,
  fast: false,
  startupDelay: 0,
};

function installDependencies(root: string): void {
  for (const command of [
    "hyprctl",
    "is-work-time",
    "uwsm",
    "chromium",
    "ghostty-host-config",
    "herdr",
  ]) {
    const path = join(root, command);
    writeFileSync(path, "#!/bin/sh\nexit 0\n");
    chmodSync(path, 0o755);
  }
  process.env.PATH = `${root}:${originalPath ?? ""}`;
}

interface MockClient {
  address: string;
  class?: string;
  title?: string;
  initialClass?: string;
  initialTitle?: string;
  workspace: { id: number };
  tags: string[];
}

function applyTagDispatch(clients: MockClient[], dispatched: string): void {
  const match =
    /^hl\.dsp\.window\.tag\(\{ tag = "([+-])([^"]+)", window = "address:([^"]+)" \}\)$/.exec(
      dispatched,
    );
  if (!match) return;
  const [, sign, tag, address] = match;
  const client = clients.find((entry) => entry.address === address);
  if (!client) return;
  if (sign === "-") {
    client.tags = client.tags.filter((value) => value !== tag);
    return;
  }
  if (!client.tags.includes(tag)) client.tags = [...client.tags, tag];
}

describe("workspace setup", () => {
  test("resolves flags before legacy environment values and validates reserved workspaces", () => {
    expect(
      resolveWorkspaceSetupConfig(
        {
          ...defaults,
          fast: true,
          temporaryWorkspace: 98,
          moveDispatcher: "movetoworkspacesilent",
          logFile: "/flag.log",
          mode: "work",
        },
        {
          WORKSPACE_SETUP_TEMP_WS: "97",
          WORKSPACE_SETUP_MOVE_DISPATCHER: "movetoworkspace",
          WORKSPACE_SETUP_LOG_FILE: "/env.log",
        },
      ),
    ).toMatchObject({
      speedMultiplier: 1,
      temporaryWorkspace: 98,
      moveDispatcher: "movetoworkspacesilent",
      follow: false,
      logFile: "/flag.log",
      mode: "work",
    });
    expect(() =>
      resolveWorkspaceSetupConfig({ ...defaults, temporaryWorkspace: 2 }),
    ).toThrow(WorkspaceSetupError);
  });

  test("rejects preflight data before mutation and releases the shared lock", async () => {
    expect(() => validateWorkspaceSetupPreflight("not-json", "{}", 99)).toThrow(
      "invalid JSON",
    );
    expect(() =>
      validateWorkspaceSetupPreflight(
        '[{"address":"0x1","workspace":{"id":99}}]',
        "{}",
        99,
      ),
    ).toThrow("already occupied");

    const root = mkdtempSync(join(tmpdir(), "workspace-setup-preflight-"));
    roots.push(root);
    installDependencies(root);
    const dispatches: string[] = [];
    const executor = Layer.succeed(CommandExecutor, {
      run: (command, args) => {
        if (command !== "hyprctl") return Effect.succeed("");
        if (args[0] === "-j" && args[1] === "clients") {
          return Effect.succeed("not-json");
        }
        if (args[0] === "-j" && args[1] === "activewindow") {
          return Effect.succeed("{}");
        }
        dispatches.push(args[1] ?? "");
        return Effect.succeed("");
      },
      stream: () => Stream.empty,
      exitCode: () => Effect.succeed(1),
      inherit: () => Effect.succeed(0),
    });
    await expect(
      Effect.runPromise(
        workspaceSetup({
          ...defaults,
          logFile: join(root, "run.log"),
        }).pipe(Effect.provide(executor)),
      ),
    ).rejects.toThrow("invalid JSON");
    expect(dispatches).toEqual([]);
    expect(existsSync(join(STATE_DIR, "dot", "workspace-mutation.lock"))).toBe(
      false,
    );
  });

  test("keeps representative non-work mutations ordered after a failed dispatch", async () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-setup-flow-"));
    roots.push(root);
    installDependencies(root);

    const clients = [
      {
        address: "0xb",
        class: "chromium",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-browser-main"],
      },
      {
        address: "0xt",
        class: "com.mitchellh.ghostty",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-term-top"],
      },
      {
        address: "0xm",
        class: "com.mitchellh.ghostty",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-term"],
      },
      {
        address: "0xh",
        class: "herdr",
        workspace: { id: 2 },
        tags: ["wssetup-ws2-term"],
      },
    ];
    const dispatches: string[] = [];
    let failed = false;
    const executor = Layer.succeed(CommandExecutor, {
      run: (command, args) => {
        if (command !== "hyprctl") return Effect.succeed("");
        if (args[0] === "-j" && args[1] === "clients") {
          return Effect.succeed(JSON.stringify(clients));
        }
        if (args[0] === "-j" && args[1] === "activewindow") {
          return Effect.succeed('{"address":"0xb"}');
        }
        dispatches.push(args[1] ?? "");
        if (!failed) {
          failed = true;
          return Effect.fail(
            new CommandError({
              command: "hyprctl",
              exitCode: 1,
              stderr: "test",
            }),
          );
        }
        return Effect.succeed("");
      },
      stream: () => Stream.empty,
      exitCode: () => Effect.succeed(1),
      inherit: () => Effect.succeed(0),
    });

    await Effect.runPromise(
      workspaceSetup({
        ...defaults,
        fast: true,
        logFile: join(root, "run.log"),
      }).pipe(Effect.provide(executor)),
    );

    const moves = dispatches.filter((command) =>
      command.startsWith("hl.dsp.window.move"),
    );
    expect(
      moves.filter((command) => command.includes('workspace = "99"')),
    ).toEqual([
      expect.stringContaining("address:0xt"),
      expect.stringContaining("address:0xb"),
      expect.stringContaining("address:0xm"),
    ]);
    expect(
      moves.filter((command) => command.includes('workspace = "1"')).slice(-3),
    ).toEqual([
      expect.stringContaining("address:0xt"),
      expect.stringContaining("address:0xb"),
      expect.stringContaining("address:0xm"),
    ]);
    expect(dispatches.at(-1)).toBe('hl.dsp.focus({ workspace = "2" })');
  });

  test("forces the normal layout without consulting is-work-time", async () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-setup-normal-"));
    roots.push(root);
    installDependencies(root);

    const clients = [
      {
        address: "0xb",
        class: "chromium",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-browser-main"],
      },
      {
        address: "0xt",
        class: "com.mitchellh.ghostty",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-term-top"],
      },
      {
        address: "0xm",
        class: "com.mitchellh.ghostty",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-term"],
      },
      {
        address: "0xh",
        class: "herdr",
        workspace: { id: 2 },
        tags: ["wssetup-ws2-term"],
      },
    ];
    const probed: string[] = [];
    const overlays: string[][] = [];
    const executor = Layer.succeed(CommandExecutor, {
      run: (command, args) => {
        if (command === "popup-loading") {
          overlays.push([...args]);
          return Effect.succeed("");
        }
        if (command !== "hyprctl") return Effect.succeed("");
        if (args[0] === "-j" && args[1] === "clients") {
          return Effect.succeed(JSON.stringify(clients));
        }
        if (args[0] === "-j" && args[1] === "activewindow") {
          return Effect.succeed('{"address":"0xb"}');
        }
        return Effect.succeed("");
      },
      stream: () => Stream.empty,
      exitCode: (command) => {
        probed.push(command);
        return Effect.succeed(0);
      },
      inherit: () => Effect.succeed(0),
    });

    await Effect.runPromise(
      workspaceSetup({
        ...defaults,
        fast: true,
        mode: "normal",
        logFile: join(root, "run.log"),
      }).pipe(Effect.provide(executor)),
    );

    expect(probed).toEqual([]);
    expect(overlays[0]).toEqual(["show", "Setting up workspace..."]);
    expect(overlays).toContainEqual(["show", "Using normal mode"]);
    expect(overlays).toContainEqual([
      "show",
      "Preparing workspace 1 non-work apps",
    ]);
    expect(overlays).toContainEqual(["show", "Workspace setup complete"]);
    expect(overlays.at(-1)).toEqual(["hide"]);
    expect(
      overlays.some(
        (args) => args[0] === "show" && args[1]?.startsWith("Moving "),
      ),
    ).toBe(false);
    expect(readFileSync(join(root, "run.log"), "utf8")).toContain(
      "Using normal mode",
    );
  });

  test("forces the work layout without consulting is-work-time", async () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-setup-work-"));
    roots.push(root);
    installDependencies(root);
    const chrome = join(root, "google-chrome-stable");
    writeFileSync(chrome, "#!/bin/sh\nexit 0\n");
    chmodSync(chrome, 0o755);

    const clients = [
      {
        address: "0xs",
        class: "chrome-app.slack.com__client",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-slack"],
      },
      {
        address: "0xd",
        class: "chrome-discord.com__app",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-discord"],
      },
      {
        address: "0xb",
        class: "chromium",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-browser-main"],
      },
      {
        address: "0xm",
        class: "com.mitchellh.ghostty",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-term"],
      },
      {
        address: "0xh",
        class: "herdr",
        workspace: { id: 2 },
        tags: ["wssetup-ws2-term"],
      },
      {
        address: "0xw",
        class: "work-browser",
        workspace: { id: 3 },
        tags: ["wssetup-ws3-browser"],
      },
    ];
    const probed: string[] = [];
    const dispatches: string[] = [];
    const executor = Layer.succeed(CommandExecutor, {
      run: (command, args) => {
        if (command !== "hyprctl") return Effect.succeed("");
        if (args[0] === "-j" && args[1] === "clients") {
          return Effect.succeed(JSON.stringify(clients));
        }
        if (args[0] === "-j" && args[1] === "activewindow") {
          return Effect.succeed('{"address":"0xb"}');
        }
        dispatches.push(args[1] ?? "");
        return Effect.succeed("");
      },
      stream: () => Stream.empty,
      exitCode: (command) => {
        probed.push(command);
        return Effect.succeed(1);
      },
      inherit: () => Effect.succeed(0),
    });

    await Effect.runPromise(
      workspaceSetup({
        ...defaults,
        fast: true,
        mode: "work",
        logFile: join(root, "run.log"),
      }).pipe(Effect.provide(executor)),
    );

    expect(probed).toEqual([]);
    const moves = dispatches.filter((command) =>
      command.startsWith("hl.dsp.window.move"),
    );
    expect(
      moves.filter((command) => command.includes('workspace = "99"')),
    ).toEqual([
      expect.stringContaining("address:0xs"),
      expect.stringContaining("address:0xd"),
      expect.stringContaining("address:0xb"),
      expect.stringContaining("address:0xm"),
    ]);
    expect(readFileSync(join(root, "run.log"), "utf8")).toContain(
      "Using work mode",
    );
  });

  test("reuses slack and discord windows whose chrome class has a profile suffix", async () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-setup-chrome-suffix-"));
    roots.push(root);
    installDependencies(root);
    const chrome = join(root, "google-chrome-stable");
    writeFileSync(chrome, "#!/bin/sh\nexit 0\n");
    chmodSync(chrome, 0o755);

    const clients: MockClient[] = [
      {
        address: "0xs",
        class: "chrome-app.slack.com__client-Default",
        workspace: { id: 4 },
        tags: [],
      },
      {
        address: "0xd",
        class: "chrome-discord.com__app-Default",
        workspace: { id: 4 },
        tags: [],
      },
      {
        address: "0xb",
        class: "chromium",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-browser-main"],
      },
      {
        address: "0xm",
        class: "com.mitchellh.ghostty",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-term"],
      },
      {
        address: "0xh",
        class: "com.mitchellh.ghostty",
        title: "herdr",
        workspace: { id: 2 },
        tags: ["wssetup-ws2-term"],
      },
      {
        address: "0xw",
        class: "work-browser",
        workspace: { id: 3 },
        tags: ["wssetup-ws3-browser"],
      },
    ];
    const execs: string[] = [];
    const dispatches: string[] = [];
    const executor = Layer.succeed(CommandExecutor, {
      run: (command, args) => {
        if (command !== "hyprctl") return Effect.succeed("");
        if (args[0] === "-j" && args[1] === "clients") {
          return Effect.succeed(JSON.stringify(clients));
        }
        if (args[0] === "-j" && args[1] === "activewindow") {
          return Effect.succeed('{"address":"0xb"}');
        }
        const dispatched = args[1] ?? "";
        dispatches.push(dispatched);
        applyTagDispatch(clients, dispatched);
        if (dispatched.startsWith("hl.dsp.exec_cmd(")) {
          execs.push(dispatched);
        }
        return Effect.succeed("");
      },
      stream: () => Stream.empty,
      exitCode: () => Effect.succeed(1),
      inherit: () => Effect.succeed(0),
    });

    await Effect.runPromise(
      workspaceSetup({
        ...defaults,
        fast: true,
        mode: "work",
        logFile: join(root, "run.log"),
      }).pipe(Effect.provide(executor)),
    );

    expect(execs).toEqual([]);
    expect(
      dispatches
        .filter((command) => command.startsWith("hl.dsp.window.move"))
        .filter((command) => command.includes('workspace = "99"')),
    ).toEqual([
      expect.stringContaining("address:0xs"),
      expect.stringContaining("address:0xd"),
      expect.stringContaining("address:0xb"),
      expect.stringContaining("address:0xm"),
    ]);
  });

  test("does not reuse a herdr ghostty window as a workspace 1 terminal", async () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-setup-herdr-slot-"));
    roots.push(root);
    installDependencies(root);

    const clients: MockClient[] = [
      {
        address: "0xb",
        class: "chromium",
        workspace: { id: 1 },
        tags: ["wssetup-ws1-browser-main"],
      },
      {
        address: "0xh",
        class: "com.mitchellh.ghostty",
        title: "herdr",
        initialClass: "com.mitchellh.ghostty",
        initialTitle: "herdr",
        workspace: { id: 2 },
        tags: ["wssetup-ws2-term"],
      },
    ];
    let nextGhostty = 0;
    const order: string[] = [];
    const execs: string[] = [];
    const dispatches: string[] = [];
    const executor = Layer.succeed(CommandExecutor, {
      run: (command, args) => {
        if (command === "popup-loading") {
          order.push("overlay");
          return Effect.succeed("");
        }
        if (command !== "hyprctl") return Effect.succeed("");
        if (args[0] === "-j" && args[1] === "clients") {
          order.push("clients");
          return Effect.succeed(JSON.stringify(clients));
        }
        if (args[0] === "-j" && args[1] === "activewindow") {
          order.push("activewindow");
          return Effect.succeed('{"address":"0xb"}');
        }
        const dispatched = args[1] ?? "";
        dispatches.push(dispatched);
        applyTagDispatch(clients, dispatched);
        if (dispatched.startsWith("hl.dsp.exec_cmd(")) {
          const launched = JSON.parse(
            dispatched.slice("hl.dsp.exec_cmd(".length, -1),
          ) as string;
          execs.push(launched);
          if (launched.includes(" -e herdr")) {
            throw new Error("existing herdr window should be reused");
          }
          nextGhostty += 1;
          clients.push({
            address: `0xg${nextGhostty}`,
            class: "com.mitchellh.ghostty",
            workspace: { id: 1 },
            tags: [],
          });
        }
        return Effect.succeed("");
      },
      stream: () => Stream.empty,
      exitCode: () => Effect.succeed(1),
      inherit: () => Effect.succeed(0),
    });

    await Effect.runPromise(
      workspaceSetup({
        ...defaults,
        fast: true,
        mode: "normal",
        logFile: join(root, "run.log"),
      }).pipe(Effect.provide(executor)),
    );

    expect(order.indexOf("clients")).toBeGreaterThan(-1);
    expect(order.indexOf("activewindow")).toBeGreaterThan(-1);
    expect(order.indexOf("overlay")).toBeGreaterThan(-1);
    expect(order.indexOf("clients")).toBeLessThan(order.indexOf("overlay"));
    expect(order.indexOf("activewindow")).toBeLessThan(
      order.indexOf("overlay"),
    );
    expect(execs).toHaveLength(2);
    expect(
      execs.every((command) => command.includes("ghostty-host-config")),
    ).toBe(true);
    const moves = dispatches.filter((command) =>
      command.startsWith("hl.dsp.window.move"),
    );
    expect(
      moves.filter((command) => command.includes('workspace = "99"')),
    ).toEqual([
      expect.stringContaining("address:0xg1"),
      expect.stringContaining("address:0xb"),
      expect.stringContaining("address:0xg2"),
    ]);
    expect(moves.filter((command) => command.includes("address:0xh"))).toEqual([
      expect.stringContaining('workspace = "2"'),
    ]);
  });
});
