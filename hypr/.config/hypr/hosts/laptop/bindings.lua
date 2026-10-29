-- Bluetooth
o.bind("SUPER + CTRL + SHIFT + B", "Bluetooth", [[DEVICE="$(bluetoothctl devices | grep -i 'MOMENTUM 4' | awk '{print $2}')" && bluetoothctl disconnect "$DEVICE" && sleep 1 && bluetoothctl connect "$DEVICE"]])

-- Local automations
o.bind("SUPER + ALT + C", "Doorbell Camera Popup", [[mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}"; nohup setsid ~/.config/dotfiles/scripts/.local/bin/doorbell-popup --open-only --no-auto-close --camera-entity camera.front_door --monitor eDP-1 --width 380 --height 450 >"${XDG_STATE_HOME:-$HOME/.local/state}/doorbell-camera-popup.log" 2>&1 < /dev/null &]])

-- Notifications: Hokum serves them here in place of the shell's plugin, which
-- omarchy-plugins.json disables on the laptop. Hokum has no keyboard control
-- or history, so those keys are left free.
hl.unbind("SUPER + comma")
o.bind("SUPER + comma", "Invoke last notification", "hokum invoke")
hl.unbind("SUPER + SHIFT + comma")
o.bind("SUPER + SHIFT + comma", "Dismiss all notifications", "hokum dismiss --all")
hl.unbind("SUPER + CTRL + comma")
hl.unbind("SUPER + ALT + comma")
o.bind("SUPER + ALT + comma", "Dismiss last notification", "hokum dismiss")
hl.unbind("SUPER + SHIFT + ALT + comma")
hl.unbind("SUPER + CTRL + ALT + comma")
o.bind("SUPER + CTRL + ALT + comma", "Toggle silencing notifications", "hokum dnd toggle")
