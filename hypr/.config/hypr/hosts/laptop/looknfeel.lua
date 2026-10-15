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

-- The Qt WebEngine Inbox window from dot plannotator inbox opens as a narrow tiled column on the left (size rules only apply to
-- floating windows), told apart from other qml windows by its title
hl.on("window.open", function(win)
  if win.floating or win.class ~= "org.qt-project.qml" or win.title ~= "Plannotator Inbox" then
    return
  end
  hl.dispatch(hl.dsp.window.move({ direction = "l", window = win }))
  hl.dispatch(hl.dsp.window.resize({ x = 280, y = win.size.y, window = win }))
end)
