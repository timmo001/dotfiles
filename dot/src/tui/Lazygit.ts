import { Effect } from "effect";
import type { CliRenderer } from "@opentui/core";
import { resizeIfFloating } from "./hyprland.js";

/** Suspend the TUI, launch lazygit in the given repo, then resume rendering. */
export async function openLazygit(
  renderer: CliRenderer,
  repoPath: string,
  afterResume?: () => void,
): Promise<void> {
  renderer.suspend();
  renderer.currentRenderBuffer.clear();
  await Effect.runPromise(resizeIfFloating(1020, 700));
  try {
    const proc = Bun.spawn(["lazygit"], {
      cwd: repoPath,
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
