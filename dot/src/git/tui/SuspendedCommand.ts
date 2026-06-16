import { Effect } from "effect";
import type { CliRenderer } from "@opentui/core";
import { resizeIfFloating, DEFAULT_FLOATING_SIZE } from "../../tui/hyprland.js";

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

/** Options for running arbitrary async work while OpenTUI is suspended. */
export interface RendererSuspensionOptions {
  /** Active OpenTUI renderer to suspend and resume. */
  readonly renderer: CliRenderer;
  /** Called after the renderer resumes. */
  readonly afterResume?: () => void;
}

/** Suspend the TUI, run async work, then restore rendering. */
export async function runWithRendererSuspended<T>(
  options: RendererSuspensionOptions,
  work: () => Promise<T>,
): Promise<T> {
  const { renderer, afterResume } = options;
  renderer.suspend();
  renderer.currentRenderBuffer.clear();

  try {
    return await work();
  } finally {
    renderer.currentRenderBuffer.clear();
    renderer.resume();
    afterResume?.();
    renderer.requestRender();
  }
}

/** Suspend the TUI, run a command with inherited stdio, then resume rendering. */
export async function runSuspendedCommand({
  renderer,
  command,
  cwd,
  afterResume,
}: SuspendedCommandOptions): Promise<void> {
  await Effect.runPromise(resizeIfFloating(1020, 700));
  try {
    await runWithRendererSuspended({ renderer, afterResume }, async () => {
      const proc = Bun.spawn([...command], {
        cwd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
    });
  } finally {
    await Effect.runPromise(
      resizeIfFloating(
        DEFAULT_FLOATING_SIZE.width,
        DEFAULT_FLOATING_SIZE.height,
      ),
    );
  }
}
