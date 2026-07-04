hl.config({
  input = {
    kb_layout = "gb",
    kb_options = "compose:caps",
    repeat_rate = 40,
    repeat_delay = 600,
    sensitivity = 0,
    numlock_by_default = true,
    accel_profile = "flat",
    touchpad = {
      disable_while_typing = true,
      natural_scroll = true,
      clickfinger_behavior = true,
    },
  },
})

require("hypr.host.input")
