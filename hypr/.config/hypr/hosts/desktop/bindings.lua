o.bind("SUPER + SHIFT + H", "Home Assistant DEV Terminal", "omarchy-launch-tui hadev")

-- Local automations
o.bind("SUPER + ALT + C", "Doorbell Camera Popup", [[mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}"; nohup setsid ~/.config/dotfiles/scripts/.local/bin/doorbell-popup --open-only --no-auto-close --monitor DP-1 >"${XDG_STATE_HOME:-$HOME/.local/state}/doorbell-camera-popup.log" 2>&1 < /dev/null &]])

-- DeckShift: Gaming Mode on SUPER+CTRL (Share and out-of-group moved in the shared bindings)
o.bind("SUPER + CTRL + S", "Gaming Mode", "/usr/local/bin/switch-to-gaming")
o.bind("SUPER + CTRL + G", "Gaming Mode panel", "omarchy-shell shell toggle nosignal.deckshift")
