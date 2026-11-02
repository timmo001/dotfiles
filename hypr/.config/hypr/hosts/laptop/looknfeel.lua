hl.config({
  general = {
    gaps_in = 0,
    col = {
      active_border = "rgba(cccccc66)",
      inactive_border = "rgba(59595966)",
    },
  },
  decoration = {
    rounding = 0,
  },
})

-- Smaller floating terminal for SUPER+SHIFT+Q launcher
hl.window_rule({ name = "floating-terminal-size", match = { class = "^org\\.omarchy\\.terminal$" }, size = "760 500" })

-- The Inbox's web app window from dot plannotator inbox opens as a narrow tiled column on the left (size rules only apply to
-- floating windows). It opens before the Inbox sets its title, so it's matched by the class Chromium gives an app window on
-- localhost's root, which another app window there would share
hl.on("window.open", function(win)
  if win.floating or win.class ~= "chrome-localhost__-Default" then
    return
  end
  hl.dispatch(hl.dsp.window.move({ direction = "l", window = win }))
  hl.dispatch(hl.dsp.window.resize({ x = 280, y = win.size.y, window = win }))
end)
