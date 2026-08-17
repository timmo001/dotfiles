import { describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import {
  herdrLazyPluginRoot,
  reloadOmarchyShellIfChanged,
  updatePinnedSubmodules,
} from "../../src/commands/Update.js";
import { CommandExecutor } from "../../src/services/CommandExecutor.js";
import { Config, type ConfigService } from "../../src/services/Config.js";
import { emptyDotGitConfig } from "../../src/services/GitConfig.js";
import { OutputLog } from "../../src/services/OutputLog.js";
import { emptyMcpConfig } from "../../src/mcp/sync/loadSpec.js";

function config(enabled: boolean): ConfigService {
  return {
    publicDotfiles: "/tmp/dotfiles",
    privateDotfiles: null,
    canUsePrivate: false,
    privateReason: "test",
    notesDir: "/tmp/notes",
    omarchy: {
      repoBase: "/tmp",
      diffRepos: [],
      worktreeRepos: [],
      worktreeBranches: [],
      expectedBranches: {},
      enabled,
    },
    gitConfig: emptyDotGitConfig("/tmp/dot-git.yml"),
    mcpConfig: emptyMcpConfig("/tmp/mcp.yml"),
    cacheDir: "/tmp/cache",
    stateDir: "/tmp/state",
    logDir: "/tmp/state/logs",
  };
}

describe("reloadOmarchyShellIfChanged", () => {
  test("restarts under Wayland", async () => {
    const calls: Array<{
      command: string;
      args: readonly string[];
      options?: { readonly env?: Readonly<Record<string, string>> };
    }> = [];
    const messages: string[] = [];
    const layers = Layer.mergeAll(
      Layer.succeed(Config, config(true)),
      Layer.succeed(CommandExecutor, {
        run: () => Effect.die("run should not be called"),
        stream: () => Stream.die("stream should not be called"),
        inherit: () => Effect.die("inherit should not be called"),
        exitCode: (command, args, options) =>
          Effect.sync(() => {
            calls.push({ command, args, options });
            return 0;
          }),
      }),
      Layer.succeed(OutputLog, {
        info: (message) => Effect.sync(() => void messages.push(message)),
        warn: () => Effect.void,
        error: () => Effect.void,
        section: () => Effect.void,
        stream: Stream.empty,
        flush: Effect.succeed(""),
        withSpinner: (_label, effect) => effect,
        updateSpinner: () => Effect.void,
      }),
    );

    await Effect.runPromise(
      reloadOmarchyShellIfChanged(true).pipe(Effect.provide(layers)),
    );

    expect(calls).toEqual([
      {
        command: "omarchy",
        args: ["restart", "shell"],
        options: { env: { QT_QPA_PLATFORM: "wayland" } },
      },
    ]);
    expect(messages).toContain("Reloaded Omarchy shell (shell.json changed)");
  });

  test("does nothing when the config did not change or Omarchy is disabled", async () => {
    for (const [changed, enabled] of [
      [false, true],
      [true, false],
    ] as const) {
      const layers = Layer.mergeAll(
        Layer.succeed(Config, config(enabled)),
        Layer.succeed(CommandExecutor, {
          run: () => Effect.die("run should not be called"),
          stream: () => Stream.die("stream should not be called"),
          inherit: () => Effect.die("inherit should not be called"),
          exitCode: () => Effect.die("exitCode should not be called"),
        }),
        Layer.succeed(OutputLog, {
          info: () => Effect.void,
          warn: () => Effect.void,
          error: () => Effect.void,
          section: () => Effect.void,
          stream: Stream.empty,
          flush: Effect.succeed(""),
          withSpinner: (_label, effect) => effect,
          updateSpinner: () => Effect.void,
        }),
      );

      await Effect.runPromise(
        reloadOmarchyShellIfChanged(changed).pipe(Effect.provide(layers)),
      );
    }
  });
});

describe("updatePinnedSubmodules", () => {
  test("restores recursive submodules to committed revisions", async () => {
    const calls: Array<{
      command: string;
      args: readonly string[];
      cwd?: string;
    }> = [];
    const layer = Layer.succeed(CommandExecutor, {
      run: () => Effect.die("run should not be called"),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.die("exitCode should not be called"),
      inherit: (command, args, options) =>
        Effect.sync(() => {
          calls.push({ command, args, cwd: options?.cwd });
          return 0;
        }),
    });

    await Effect.runPromise(
      updatePinnedSubmodules("/tmp/dotfiles").pipe(Effect.provide(layer)),
    );

    expect(calls).toEqual([
      {
        command: "git",
        args: ["submodule", "update", "--init", "--recursive"],
        cwd: "/tmp/dotfiles",
      },
    ]);
  });
});

describe("herdrLazyPluginRoot", () => {
  test("returns the installed Herdr Lazy plugin root", () => {
    expect(
      herdrLazyPluginRoot(
        JSON.stringify({
          result: {
            plugins: [
              { plugin_id: "other", plugin_root: "/plugins/other" },
              {
                plugin_id: "herdr-lazy",
                plugin_root: "/plugins/herdr-lazy",
              },
            ],
          },
        }),
      ),
    ).toBe("/plugins/herdr-lazy");
  });

  test("returns null for missing or malformed plugin data", () => {
    expect(herdrLazyPluginRoot("not json")).toBeNull();
    expect(herdrLazyPluginRoot('{"result":{"plugins":[]}}')).toBeNull();
    expect(
      herdrLazyPluginRoot(
        '{"result":{"plugins":[{"plugin_id":"herdr-lazy"}]}}',
      ),
    ).toBeNull();
  });
});
