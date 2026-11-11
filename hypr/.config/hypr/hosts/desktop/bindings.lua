o.bind("SUPER + SHIFT + H", "Home Assistant DEV Terminal", "omarchy-launch-tui hadev")

-- PRO X SUPERLIGHT 2c: the button that was slow DPI (BTN_EXTRA) does what F9 does.
-- Needs onboard profiles off in Solaar, or the mouse handles it and sends nothing.
o.bind("mouse:276", "Hex dictation", hl.dsp.global("anomaly.hex:dictation"))

-- Local automations
o.bind("SUPER + ALT + C", "Doorbell Camera Popup", [[mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}"; nohup setsid ~/.config/dotfiles/scripts/.local/bin/doorbell-popup --open-only --no-auto-close --monitor DP-1 >"${XDG_STATE_HOME:-$HOME/.local/state}/doorbell-camera-popup.log" 2>&1 < /dev/null &]])
