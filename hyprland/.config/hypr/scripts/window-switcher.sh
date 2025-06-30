#!/bin/bash

# Advanced window switcher with preview
if ! command -v jq >/dev/null 2>&1; then
    notify-send "Window Switcher" "jq not installed. Install with: sudo pacman -S jq"
    exit 1
fi

# Get all windows and format them nicely
window_info=$(hyprctl clients -j | jq -r '.[] | select(.workspace.id != -1) | "\(.class) - \(.title) [WS: \(.workspace.name // .workspace.id)]"')

if [ -z "$window_info" ]; then
    notify-send "Window Switcher" "No windows found"
    exit 0
fi

# Show window selector
selected=$(echo "$window_info" | wofi --dmenu --prompt "Switch to Window" --width 1000 --height 500)

if [ -n "$selected" ]; then
    # Extract class name (first word before " - ")
    class=$(echo "$selected" | cut -d' ' -f1)
    # Focus the window
    hyprctl dispatch focuswindow "class:$class"
fi