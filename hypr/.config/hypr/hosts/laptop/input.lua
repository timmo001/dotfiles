hl.config({
  input = {
    sensitivity = 0.35,
    touchpad = {
      scroll_factor = 0.4,
    },
  },
})

-- Scroll speed adjustments
hl.window_rule({ name = "scroll-alacritty", match = { class = "Alacritty" }, scroll_touchpad = 1.50 })
hl.window_rule({ name = "scroll-ghostty", match = { class = "Ghostty" }, scroll_touchpad = 1.50 })
hl.window_rule({ name = "scroll-chromium", match = { class = "^(Chromium|chromium|google-chrome|google-chrome-stable|google-chrome-unstable)$" }, scroll_touchpad = 0.25 })
