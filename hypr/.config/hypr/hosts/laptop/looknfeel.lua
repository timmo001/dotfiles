hl.config({
  general = {
    gaps_in = 0,
    col = {
      active_border = "rgba(ccccccaa)",
    },
  },
})

-- Smaller floating terminal for SUPER+SHIFT+Q launcher
hl.window_rule({ name = "floating-terminal-size", match = { class = "^org\\.omarchy\\.terminal$" }, size = "760 500" })
