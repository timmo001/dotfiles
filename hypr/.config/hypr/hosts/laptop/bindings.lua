-- Bluetooth
o.bind("SUPER + ALT + CTRL + B", "Bluetooth", [[DEVICE="$(bluetoothctl devices | grep -i 'MOMENTUM 4' | awk '{print $2}')" && bluetoothctl disconnect "$DEVICE" && sleep 1 && bluetoothctl connect "$DEVICE"]])

-- Local automations
o.bind("SUPER + ALT + C", "Doorbell Camera Popup", [[mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}"; nohup setsid ~/.config/dotfiles/scripts/.local/bin/doorbell-popup --open-only --no-auto-close --camera-entity camera.front_door_snapshot --monitor eDP-1 --width 380 --height 450 >"${XDG_STATE_HOME:-$HOME/.local/state}/doorbell-camera-popup.log" 2>&1 < /dev/null &]])

-- Gamma-only dimming toggle
o.bind("SUPER + CTRL + D", "Toggle dimming", "~/.config/hypr/bin/hyprsunset-toggle-dim")
o.bind("SUPER + CTRL + code:20", "Dim down", "~/.config/hypr/bin/hyprsunset-dim-step down")
o.bind("SUPER + CTRL + code:21", "Dim up", "~/.config/hypr/bin/hyprsunset-dim-step up")
o.bind("CTRL + XF86MonBrightnessUp", "Dim up", "~/.config/hypr/bin/hyprsunset-dim-step up", { locked = true, repeating = true })
o.bind("CTRL + XF86MonBrightnessDown", "Dim down", "~/.config/hypr/bin/hyprsunset-dim-step down", { locked = true, repeating = true })

-- Normal brightness disables dim
hl.unbind("XF86MonBrightnessUp")
hl.unbind("XF86MonBrightnessDown")
o.bind("XF86MonBrightnessUp", "Brightness up", "~/.config/hypr/bin/hyprsunset-clear-dim && omarchy-brightness-display +5%", { locked = true, repeating = true })
o.bind("XF86MonBrightnessDown", "Brightness down", "~/.config/hypr/bin/hyprsunset-clear-dim && omarchy-brightness-display 5%-", { locked = true, repeating = true })
