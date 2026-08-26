/**
 * @file Registers a TUI keybinding (ctrl+shift+g) to open `dot git-diff`.
 */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "dot-git-diff.open",
        title: "Open dot git-diff",
        category: "Plugin",
        namespace: "palette",
        slashName: "dot-git-diff",
        run() {
          api.renderer.suspend()
          try {
            // The renderer is suspended and stdio is inherited, so dot runs
            // against the real TTY. dot's agent gate would otherwise detect
            // OpenCode as an ancestor process and refuse to open the TUI, so
            // force it on with DOT_AGENT=0 (its documented escape hatch).
            Bun.spawnSync(["dot", "git-diff"], {
              stdin: "inherit",
              stdout: "inherit",
              stderr: "inherit",
              env: { ...process.env, DOT_AGENT: "0" },
            })
          } finally {
            api.renderer.resume()
          }
        },
      },
    ],
    bindings: [
      { key: "ctrl+shift+g", cmd: "dot-git-diff.open", desc: "Open dot git-diff" },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "dot-git-diff",
  tui,
}

export default plugin
