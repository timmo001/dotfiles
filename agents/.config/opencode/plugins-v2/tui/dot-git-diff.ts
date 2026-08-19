import type { Plugin } from "@opencode-ai/plugin/tui"

const plugin = {
  id: "timmo.tui.dot-git-diff",
  setup(context) {
    return context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "dot-git-diff.open",
              title: "Open dot git-diff",
              description: "Review the current repository diff",
              group: "Plugin",
              bind: "ctrl+shift+g",
              palette: true,
              slash: { name: "dot-git-diff" },
              run() {
                context.renderer.suspend()
                try {
                  Bun.spawnSync(["dot", "git-diff"], {
                    stdin: "inherit",
                    stdout: "inherit",
                    stderr: "inherit",
                    env: {
                      ...process.env,
                      DOT_AGENT: "0",
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
          bindings: ["dot-git-diff.open"],
        }))
        return null
      },
    })
  },
} satisfies Plugin.Definition

export default plugin
