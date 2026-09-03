import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { CommandExecutor } from "../../src/services/CommandExecutor.js";

describe("CommandExecutor", () => {
  test("keeps inherited commands in the caller's terminal session", async () => {
    const exitCode = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* CommandExecutor;
        return yield* executor.inherit("sh", [
          "-c",
          'test "$(ps -o sid= -p $$)" = "$(ps -o sid= -p $PPID)"',
        ]);
      }).pipe(Effect.provide(CommandExecutor.layer)),
    );

    expect(exitCode).toBe(0);
  });

  test("merges environment overrides for inherited commands", async () => {
    const exitCode = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* CommandExecutor;
        return yield* executor.inherit(
          "sh",
          ["-c", 'test "$COMMAND_EXECUTOR_TEST" = inherited'],
          { env: { COMMAND_EXECUTOR_TEST: "inherited" } },
        );
      }).pipe(Effect.provide(CommandExecutor.layer)),
    );

    expect(exitCode).toBe(0);
  });
});
