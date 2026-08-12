-- Bluetooth
o.bind("SUPER + CTRL + SHIFT + B", "Bluetooth", [[DEVICE="$(bluetoothctl devices | grep -i 'MOMENTUM 4' | awk '{print $2}')" && bluetoothctl disconnect "$DEVICE" && sleep 1 && bluetoothctl connect "$DEVICE"]])

-- Local automations
o.bind("SUPER + ALT + C", "Doorbell Camera Popup", [[mkdir -p "${XDG_STATE_HOME:-$HOME/.local/state}"; nohup setsid ~/.config/dotfiles/scripts/.local/bin/doorbell-popup --open-only --no-auto-close --camera-entity camera.front_door_snapshot --monitor eDP-1 --width 380 --height 450 >"${XDG_STATE_HOME:-$HOME/.local/state}/doorbell-camera-popup.log" 2>&1 < /dev/null &]])
