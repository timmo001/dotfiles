import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "lazygit.open",
        title: "Open lazygit",
        category: "Plugin",
        namespace: "palette",
        slashName: "lazygit",
        run() {
          api.renderer.suspend()
          try {
            Bun.spawnSync(["lazygit"], {
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
    bindings: [{ key: "ctrl+g", cmd: "lazygit.open", desc: "Open lazygit" }],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "lazygit",
  tui,
}

export default plugin
