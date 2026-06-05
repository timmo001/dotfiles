import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async (api) => {
  const runInteractiveCommand = (command: string[]) => {
    return () => {
      api.renderer.suspend()
      try {
        Bun.spawnSync(command, {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          env: process.env,
        })
      } finally {
        api.renderer.resume()
      }
    }
  }

  api.keymap.registerLayer({
    commands: [
      {
        name: "lazygit.open",
        title: "Open lazygit",
        category: "Plugin",
        namespace: "palette",
        slashName: "lazygit",
        run: runInteractiveCommand(["lazygit"]),
      },
      {
        name: "dot-git-diff.open",
        title: "Open dot git-diff",
        category: "Plugin",
        namespace: "palette",
        slashName: "dot-git-diff",
        run: runInteractiveCommand(["dot", "git-diff"]),
      },
    ],
    bindings: [
      { key: "ctrl+g", cmd: "lazygit.open", desc: "Open lazygit" },
      { key: "ctrl+shift+g", cmd: "dot-git-diff.open", desc: "Open dot git-diff" },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "lazygit",
  tui,
}

export default plugin
