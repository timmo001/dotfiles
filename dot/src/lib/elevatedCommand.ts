import { Effect } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";

function isRoot(): boolean {
  return process.getuid?.() === 0;
}

/** Resolve a command through sudo/pkexec when the current process is not root. */
export function elevatedCommand(
  command: string,
  args: readonly string[],
): Effect.Effect<readonly [string, readonly string[]], never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    if (isRoot()) return [command, args] as const;

    if ((yield* executor.exitCode("which", ["sudo"])) === 0) {
      return ["sudo", [command, ...args]] as const;
    }

    return ["pkexec", [command, ...args]] as const;
  });
}

/** Run a command with inherited stdio, escalating through pkexec/sudo if needed. */
export function runElevated(
  command: string,
  args: readonly string[],
): Effect.Effect<number, never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const [elevated, elevatedArgs] = yield* elevatedCommand(command, args);
    return yield* executor.inherit(elevated, elevatedArgs);
  });
}
