import type { Context } from "@opencode-ai/plugin/tui"

const plugin = {
  id: "timmo.tui.lazygit",
  setup(context: Context) {
    return context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "lazygit.open",
              title: "Open lazygit",
              description: "Open lazygit in the current terminal",
              group: "Plugin",
              bind: "ctrl+g",
              palette: true,
              slash: { name: "lazygit" },
              run() {
                context.renderer.suspend()
                try {
                  Bun.spawnSync(["lazygit"], {
                    stdin: "inherit",
                    stdout: "inherit",
                    stderr: "inherit",
                    env: {
                      ...process.env,
                      XDG_CACHE_HOME: process.env.OPENCODE2_HOST_XDG_CACHE_HOME,
                      XDG_DATA_HOME: process.env.OPENCODE2_HOST_XDG_DATA_HOME,
                      XDG_STATE_HOME: process.env.OPENCODE2_HOST_XDG_STATE_HOME,
                    },
                  })
                } finally {
                  context.renderer.resume()
                }
              },
            },
          ],
          bindings: ["lazygit.open"],
        }))
        return null
      },
    })
  },
}

export default plugin
