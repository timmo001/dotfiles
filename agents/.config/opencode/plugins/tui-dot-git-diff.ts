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
            Bun.spawnSync(["dot", "git-diff"], {
              stdin: "inherit",
              stdout: "inherit",
              stderr: "inherit",
              env: process.env,
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
