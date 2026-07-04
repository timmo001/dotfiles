hl.config({
  general = {
    gaps_in = 2,
    col = {
      active_border = "rgba(ccccffff)",
    },
  },

  decoration = {
    rounding = 4,
    shadow = {
      enabled = true,
      range = 2,
      render_power = 3,
      color = "rgba(1a1a1aee)",
    },
    blur = {
      enabled = true,
      size = 3,
      passes = 1,
      vibrancy = 0.1696,
    },
  },
})

-- Steam: keep the main client tiled while login/dialog windows can stay floating.
hl.window_rule({ name = "workspace-steam", match = { class = "^(steam)$" }, workspace = "2 silent" })
hl.window_rule({ name = "tile-steam-main", match = { class = "^(steam)$", title = "^Steam$" }, float = false })

-- Workspace rules.
hl.window_rule({ name = "workspace-chromium", match = { class = "^(chromium)$" }, workspace = "1" })
hl.window_rule({ name = "workspace-discord", match = { class = "^(chrome-discord\\.com__app)" }, workspace = "1 silent" })
hl.window_rule({ name = "workspace-slack", match = { class = "^(chrome-app\\.slack\\.com__client)" }, workspace = "1 silent" })
hl.window_rule({ name = "workspace-work-browser", match = { class = "^(work-browser)$" }, workspace = "3" })
