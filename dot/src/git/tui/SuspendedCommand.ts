import { Effect } from "effect";
import type { CliRenderer } from "@opentui/core";
import { resizeIfFloating } from "../../tui/hyprland.js";

/** Options for running an inherited-stdio command while OpenTUI is suspended. */
export interface SuspendedCommandOptions {
  /** Active OpenTUI renderer to suspend and resume. */
  readonly renderer: CliRenderer;
  /** Command and arguments to spawn. */
  readonly command: readonly string[];
  /** Working directory for the spawned command. */
  readonly cwd: string;
  /** Called after the renderer resumes. */
  readonly afterResume?: () => void;
}

/** Suspend the TUI, run a command with inherited stdio, then resume rendering. */
export async function runSuspendedCommand({
  renderer,
  command,
  cwd,
  afterResume,
}: SuspendedCommandOptions): Promise<void> {
  renderer.suspend();
  renderer.currentRenderBuffer.clear();
  await Effect.runPromise(resizeIfFloating(1020, 700));
  try {
    const proc = Bun.spawn([...command], {
      cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
  } finally {
    await Effect.runPromise(resizeIfFloating(500, 600));
    renderer.currentRenderBuffer.clear();
    renderer.resume();
    afterResume?.();
    renderer.requestRender();
  }
}
