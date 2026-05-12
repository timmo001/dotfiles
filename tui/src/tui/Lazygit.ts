import type { CliRenderer } from "@opentui/core"

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
