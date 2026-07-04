hl.config({
  general = {
    gaps_in = 0,
    col = {
      active_border = "rgba(cccccc66)",
      inactive_border = "rgba(59595966)",
    },
  },
  decoration = {
    rounding = 1,
  },
})

-- Smaller floating terminal for SUPER+SHIFT+Q launcher
hl.window_rule({ name = "floating-terminal-size", match = { class = "^org\\.omarchy\\.terminal$" }, size = "760 500" })
