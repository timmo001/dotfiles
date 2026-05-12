import type { CliRenderer } from "@opentui/core"

/** Suspend the TUI, launch lazygit in the given repo, then resume rendering */
export async function openLazygit(
  renderer: CliRenderer,
  repoPath: string,
): Promise<void> {
  renderer.suspend()
  renderer.currentRenderBuffer.clear()
  try {
    const proc = Bun.spawn(["lazygit"], {
      cwd: repoPath,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    await proc.exited
  } finally {
    renderer.currentRenderBuffer.clear()
    renderer.resume()
    renderer.requestRender()
  }
}
