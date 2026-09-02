import { describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { runSkillsMaintenance } from "../../src/commands/Skills.js";
import { CommandExecutor } from "../../src/services/CommandExecutor.js";
import { Config } from "../../src/services/Config.js";

describe("skills facade", () => {
  test("forwards arguments with inherited stdio", async () => {
    const calls: Array<readonly [string, readonly string[]]> = [];
    const layer = Layer.succeed(CommandExecutor, {
      run: () => Effect.die("run should not be called"),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.die("exitCode should not be called"),
      inherit: (command, args, options) =>
        Effect.sync(() => {
          calls.push([command, args]);
          expect(options?.cwd).toBe(`${process.env.HOME}/repos/skills`);
          return 0;
        }),
    });

    await Effect.runPromise(
      runSkillsMaintenance([
        "updates-agent",
        "device",
        "--config",
        "/tmp/config.yml",
        "--run-id",
        "123",
      ]).pipe(Effect.provide(Layer.mergeAll(layer, Config.layer))),
    );

    expect(calls).toEqual([
      [
        `${process.env.HOME}/.local/bin/skill-maintenance`,
        [
          "updates-agent",
          "device",
          "--config",
          "/tmp/config.yml",
          "--run-id",
          "123",
        ],
      ],
    ]);
  });

  test("preserves a non-zero child exit code", async () => {
    const layer = Layer.succeed(CommandExecutor, {
      run: () => Effect.die("run should not be called"),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.die("exitCode should not be called"),
      inherit: () => Effect.succeed(75),
    });

    const exit = await Effect.runPromise(
      Effect.exit(
        runSkillsMaintenance(["validate"]).pipe(
          Effect.provide(Layer.mergeAll(layer, Config.layer)),
        ),
      ),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(String(exit.cause)).toContain("75");
    }
  });
});
