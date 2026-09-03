import { afterEach, describe, expect, test } from "bun:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Stream } from "effect";
import { CliConfig, Command } from "effect/unstable/cli";
import { existsSync } from "fs";
import { delimiter } from "path";
import { cliBuiltIns, dotCommand } from "../../src/cli/spec.js";
import { systemUpdate } from "../../src/commands/SystemUpdate.js";
import { STATE_DIR } from "../../src/lib/paths.js";
import { CommandExecutor } from "../../src/services/CommandExecutor.js";

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

const originalDotAgent = process.env.DOT_AGENT;

afterEach(() => {
  if (originalDotAgent === undefined) delete process.env.DOT_AGENT;
  else process.env.DOT_AGENT = originalDotAgent;
  process.exitCode = 0;
});

function executorLayer(calls: Call[], exitCodes: readonly number[] = []) {
  return Layer.succeed(CommandExecutor, {
    run: () => Effect.die("run should not be called"),
    stream: () => Stream.die("stream should not be called"),
    exitCode: () => Effect.die("exitCode should not be called"),
    inherit: (command, args, options) =>
      Effect.sync(() => {
        calls.push({ command, args, env: options?.env });
        return exitCodes[calls.length - 1] ?? 0;
      }),
  });
}

function testLayer(calls: Call[], exitCodes: readonly number[] = []) {
  return Layer.mergeAll(executorLayer(calls, exitCodes), NodeServices.layer);
}

describe("systemUpdate", () => {
  test("runs every update in order for --yes and scopes the mise environment", async () => {
    process.env.DOT_AGENT = "0";
    const calls: Call[] = [];

    await Effect.runPromise(
      systemUpdate({ yes: true }).pipe(Effect.provide(testLayer(calls))),
    );

    expect(calls).toEqual([
      { command: "dot", args: ["update"], env: undefined },
      { command: "dot", args: ["stow", "--public"], env: undefined },
      {
        command: "omarchy",
        args: ["update", "-y"],
        env: {
          MISE_GLOBAL_CONFIG_FILE: `${STATE_DIR}/mise/omarchy-config.toml`,
        },
      },
      { command: "topgrade", args: ["-y"], env: undefined },
    ]);
  });

  test("propagates a child exit code and stops the sequence", async () => {
    process.env.DOT_AGENT = "0";
    const calls: Call[] = [];
    process.exitCode = 0;

    await Effect.runPromise(
      Command.runWith(dotCommand, { version: "1.0.0" })([
        "system-update",
        "--yes",
      ]).pipe(
        Effect.provide(
          Layer.mergeAll(
            testLayer(calls, [0, 42]),
            CliConfig.layer({ builtIns: cliBuiltIns }),
          ),
        ),
      ) as Effect.Effect<void, unknown, never>,
    );

    expect(process.exitCode).toBe(42);
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      ["dot", "update"],
      ["dot", "stow", "--public"],
    ]);
  });

  test("scopes the agent sudo shim to child environments", async () => {
    process.env.DOT_AGENT = "1";
    const calls: Call[] = [];

    await Effect.runPromise(
      systemUpdate({ yes: true }).pipe(Effect.provide(testLayer(calls))),
    );

    const shimDirectory = calls[0].env?.PATH?.split(delimiter)[0];
    expect(shimDirectory).toContain("dot-system-update-");
    expect(
      calls.every(({ env }) => env?.PATH?.startsWith(`${shimDirectory}:`)),
    ).toBe(true);
    expect(process.env.PATH?.startsWith(`${shimDirectory}:`)).toBe(false);
    expect(existsSync(shimDirectory ?? "")).toBe(false);
  });
});
