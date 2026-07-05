import { Effect } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { ENV, envString } from "./env.js";

let sudoKeepAliveActive = false;

type KeepAliveProcess = Pick<Bun.Subprocess, "kill">;

function isRoot(): boolean {
  return process.getuid?.() === 0;
}

/** Whether a graphical session is present to drive a polkit prompt. */
function hasGraphicalSession(): boolean {
  return !!envString(ENV.WAYLAND_DISPLAY) || !!envString(ENV.DISPLAY);
}

/** Escalation binary chosen for a privileged, non-root command. */
export type ElevationBinary = "pkexec" | "sudo";

/** Inputs that determine which escalation binary to use. */
export interface ElevationInputs {
  /** Whether `pkexec` is available on PATH. */
  readonly hasPkexec: boolean;
  /** Whether `sudo` is available on PATH. */
  readonly hasSudo: boolean;
  /** Whether a graphical session can drive a polkit prompt. */
  readonly hasGraphicalSession: boolean;
  /** Whether this process has established a sudo credential cache. */
  readonly preferSudo?: boolean;
}

/**
 * Choose the escalation binary for a privileged command.
 *
 * Prefers `pkexec` when it is installed and a graphical session can drive its
 * polkit prompt, which is the case that works headlessly under an agent with no
 * controlling tty. Falls back to `sudo` for tty-only hosts (including a headless
 * box that has `pkexec` installed but no polkit agent), and uses `pkexec` as a
 * last resort when `sudo` is absent.
 */
export function chooseElevationBinary(
  inputs: ElevationInputs,
): ElevationBinary {
  if (inputs.preferSudo && inputs.hasSudo) return "sudo";
  if (inputs.hasPkexec && inputs.hasGraphicalSession) return "pkexec";
  if (inputs.hasSudo) return "sudo";
  return "pkexec";
}

/** Prompt once for sudo and keep the credential alive for the scoped effect. */
export function withSudoKeepAlive<E, R>(
  effect: Effect.Effect<void, E, R>,
): Effect.Effect<void, E, R | CommandExecutor> {
  if (isRoot()) return effect;
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      if ((yield* executor.exitCode("which", ["sudo"])) !== 0) return null;

      const exitCode = yield* executor.inherit("sudo", ["-v"]);
      if (exitCode !== 0) return null;

      sudoKeepAliveActive = true;
      return Bun.spawn(
        ["sh", "-c", "while true; do sudo -n true; sleep 60; done"],
        {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        },
      );
    }),
    () => effect,
    (keepAlive) =>
      Effect.sync(() => {
        sudoKeepAliveActive = false;
        killKeepAlive(keepAlive);
      }),
  );
}

function killKeepAlive(keepAlive: KeepAliveProcess | null): void {
  try {
    keepAlive?.kill();
  } catch {
    // The keepalive process may have already exited if sudo validation expired.
  }
}

/** Resolve a command through pkexec/sudo when the current process is not root. */
export function elevatedCommand(
  command: string,
  args: readonly string[],
): Effect.Effect<readonly [string, readonly string[]], never, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    if (isRoot()) return [command, args] as const;

    const hasPkexec = (yield* executor.exitCode("which", ["pkexec"])) === 0;
    const hasSudo = (yield* executor.exitCode("which", ["sudo"])) === 0;
    const binary = chooseElevationBinary({
      hasPkexec,
      hasSudo,
      hasGraphicalSession: hasGraphicalSession(),
      preferSudo: sudoKeepAliveActive,
    });
    return [binary, [command, ...args]] as const;
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
