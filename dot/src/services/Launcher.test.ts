import { describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { CommandExecutor } from "./CommandExecutor.js";
import { Launcher } from "./Launcher.js";
import { OutputLog } from "./OutputLog.js";

describe("Launcher", () => {
  test("passes prompt content directly to argv without a shell", async () => {
    const calls: Array<readonly [string, readonly string[]]> = [];
    const commandExecutor = Layer.succeed(CommandExecutor, {
      run: () => Effect.die("run should not be called"),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.die("exitCode should not be called"),
      inherit: (command, args) =>
        Effect.sync(() => {
          calls.push([command, args]);
          return 0;
        }),
    });
    const outputLog = Layer.succeed(OutputLog, {
      info: () => Effect.void,
      warn: () => Effect.void,
      error: () => Effect.void,
      section: () => Effect.void,
      stream: Stream.empty,
      flush: Effect.succeed(""),
      withSpinner: (_label, effect) => effect,
      updateSpinner: () => Effect.void,
    });
    const prompt = "Review $(touch /tmp/should-not-run) and `uname`.";
    const launcherLayer = Launcher.cliLayer.pipe(
      Layer.provideMerge(commandExecutor),
      Layer.provideMerge(outputLog),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const launcher = yield* Launcher;
        yield* launcher.suspendArgv(["opencode", "--prompt", prompt]);
      }).pipe(Effect.provide(launcherLayer)),
    );

    expect(calls).toEqual([["opencode", ["--prompt", prompt]]]);
  });

  test("turns spawn defects into LauncherError", async () => {
    const commandExecutor = Layer.succeed(CommandExecutor, {
      run: () => Effect.die("run should not be called"),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.die("exitCode should not be called"),
      inherit: () => Effect.die("executable not found"),
    });
    const outputLog = Layer.succeed(OutputLog, {
      info: () => Effect.void,
      warn: () => Effect.void,
      error: () => Effect.void,
      section: () => Effect.void,
      stream: Stream.empty,
      flush: Effect.succeed(""),
      withSpinner: (_label, effect) => effect,
      updateSpinner: () => Effect.void,
    });
    const launcherLayer = Launcher.cliLayer.pipe(
      Layer.provideMerge(commandExecutor),
      Layer.provideMerge(outputLog),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const launcher = yield* Launcher;
        return yield* launcher.suspendArgv(["missing-command"]);
      }).pipe(Effect.flip, Effect.provide(launcherLayer)),
    );

    expect(result._tag).toBe("LauncherError");
    expect(result.message).toContain("missing-command");
  });
});
