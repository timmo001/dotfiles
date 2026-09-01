import { describe, expect, test } from "bun:test";
import { Effect, Layer, Schedule, Stream } from "effect";
import { openHerdrRepo } from "../../src/commands/HerdrRepoOpen.js";
import {
  CommandError,
  CommandExecutor,
} from "../../src/services/CommandExecutor.js";

type Command = readonly [string, readonly string[]];

function commandError(command: string) {
  return new CommandError({ command, exitCode: 1, stderr: "not ready" });
}

function executorLayer(options: {
  readonly run: (
    command: string,
    args: readonly string[],
  ) => Effect.Effect<string, CommandError>;
  readonly calls: Command[];
}) {
  return Layer.succeed(CommandExecutor, {
    run: (command, args) =>
      Effect.suspend(() => {
        options.calls.push([command, args]);
        return options.run(command, args);
      }),
    stream: () => Stream.die("stream should not be called"),
    exitCode: (command, args) =>
      Effect.sync(() => {
        options.calls.push([command, args]);
        return 0;
      }),
    inherit: () => Effect.die("inherit should not be called"),
  });
}

describe("Herdr repository opener workflow", () => {
  test("waits for the foreground client before focusing the workspace", async () => {
    const calls: Command[] = [];
    let clientChecks = 0;
    const layer = executorLayer({
      calls,
      run: (_command, args) => {
        if (args[0] === "workspace" && args[1] === "list") {
          return Effect.succeed(
            '{"result":{"workspaces":[{"workspace_id":"w1","label":"Repo"}]}}',
          );
        }
        return Effect.succeed("{}");
      },
    });

    await Effect.runPromise(
      openHerdrRepo(
        {
          pane: false,
          label: "Repo",
          directory: "/repo",
          tabLabel: "Shell",
          pickerCache: "/missing",
        },
        {
          readinessSchedule: Schedule.recurs(2),
          foregroundClientReady: Effect.sync(() => {
            clientChecks += 1;
            return clientChecks > 2;
          }),
          launchTerminal: Effect.sync(() => {
            calls.push([
              "uwsm",
              [
                "app",
                "--",
                "ghostty-host-config",
                "-e",
                "herdr",
                "session",
                "attach",
                "default",
              ],
            ]);
          }),
        },
      ).pipe(Effect.provide(layer)),
    );

    expect(clientChecks).toBe(3);
    expect(calls).toContainEqual([
      "uwsm",
      [
        "app",
        "--",
        "ghostty-host-config",
        "-e",
        "herdr",
        "session",
        "attach",
        "default",
      ],
    ]);
    expect(calls.at(-1)).toEqual(["herdr", ["workspace", "focus", "w1"]]);
  });

  test("opens a command in a new tab of an existing workspace", async () => {
    const calls: Command[] = [];
    const layer = executorLayer({
      calls,
      run: (command, args) => {
        if (args[0] === "workspace" && args[1] === "list") {
          return Effect.succeed(
            '{"result":{"workspaces":[{"workspace_id":"w1","label":"Repo"}]}}',
          );
        }
        if (args[0] === "tab" && args[1] === "create") {
          return Effect.succeed(
            '{"result":{"tab":{"tab_id":"w1:t2"},"root_pane":{"pane_id":"w1:p2"}}}',
          );
        }
        return command === "herdr"
          ? Effect.succeed("{}")
          : Effect.fail(commandError(command));
      },
    });

    await Effect.runPromise(
      openHerdrRepo(
        {
          pane: false,
          label: "Repo",
          directory: "/repo",
          tabLabel: "Editor",
          command: "nvim .",
          pickerCache: "/missing",
        },
        { foregroundClientReady: Effect.succeed(true) },
      ).pipe(Effect.provide(layer)),
    );

    expect(calls).toContainEqual(["herdr", ["pane", "run", "w1:p2", "nvim ."]]);
    expect(calls.slice(-2)).toEqual([
      ["herdr", ["workspace", "focus", "w1"]],
      ["herdr", ["tab", "focus", "w1:t2"]],
    ]);
  });

  test("creates a missing workspace and starts its command", async () => {
    const calls: Command[] = [];
    const layer = executorLayer({
      calls,
      run: (_command, args) => {
        if (args[0] === "workspace" && args[1] === "list") {
          return Effect.succeed('{"result":{"workspaces":[]}}');
        }
        if (args[0] === "workspace" && args[1] === "create") {
          return Effect.succeed(
            '{"result":{"workspace":{"workspace_id":"w2"},"tab":{"tab_id":"w2:t1"},"root_pane":{"pane_id":"w2:p1"}}}',
          );
        }
        return Effect.succeed("{}");
      },
    });

    await Effect.runPromise(
      openHerdrRepo(
        {
          pane: false,
          label: "Repo",
          directory: "/repo",
          tabLabel: "OpenCode",
          command: "opencode",
          pickerCache: "/missing",
        },
        { foregroundClientReady: Effect.succeed(true) },
      ).pipe(Effect.provide(layer)),
    );

    expect(calls).toContainEqual([
      "herdr",
      [
        "workspace",
        "create",
        "--cwd",
        "/repo",
        "--label",
        "Repo",
        "--no-focus",
      ],
    ]);
    expect(calls).toContainEqual([
      "herdr",
      ["pane", "run", "w2:p1", "opencode"],
    ]);
  });
});
