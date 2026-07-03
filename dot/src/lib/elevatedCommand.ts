import { Effect } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { ENV, envString } from "./env.js";

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
  if (inputs.hasPkexec && inputs.hasGraphicalSession) return "pkexec";
  if (inputs.hasSudo) return "sudo";
  return "pkexec";
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
