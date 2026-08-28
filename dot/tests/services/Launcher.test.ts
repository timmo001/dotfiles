import { describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { CommandExecutor } from "../../src/services/CommandExecutor.js";
import { Launcher } from "../../src/services/Launcher.js";
import { OutputLog } from "../../src/services/OutputLog.js";

describe("Launcher", () => {
  test("passes prompt content directly to argv without a shell", async () => {
    const calls: Array<
      readonly [
        string,
        readonly string[],
        { readonly cwd?: string } | undefined,
      ]
    > = [];
    const commandExecutor = Layer.succeed(CommandExecutor, {
      run: () => Effect.die("run should not be called"),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.die("exitCode should not be called"),
      inherit: (command, args, opts) =>
        Effect.sync(() => {
          calls.push([command, args, opts]);
          return 0;
        }),
    });
    const outputLog = Layer.succeed(OutputLog, {
      info: () => Effect.void,
      warn: () => Effect.void,
      error: () => Effect.void,
      section: () => Effect.void,
      withSpinner: (_label, effect) => effect,
      updateSpinner: () => Effect.void,
    });
    const prompt = "Review $(touch /tmp/should-not-run) and `uname`.";
    const launcherLayer = Launcher.layer.pipe(
      Layer.provideMerge(commandExecutor),
      Layer.provideMerge(outputLog),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const launcher = yield* Launcher;
        yield* launcher.suspendArgv(["opencode", "--prompt", prompt], {
          cwd: "/tmp/skills",
        });
      }).pipe(Effect.provide(launcherLayer)),
    );

    expect(calls).toEqual([
      ["opencode", ["--prompt", prompt], { cwd: "/tmp/skills" }],
    ]);
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
      withSpinner: (_label, effect) => effect,
      updateSpinner: () => Effect.void,
    });
    const launcherLayer = Launcher.layer.pipe(
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
