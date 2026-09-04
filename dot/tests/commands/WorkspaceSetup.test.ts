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
});
