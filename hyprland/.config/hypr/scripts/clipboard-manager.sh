#!/bin/bash

# Enhanced clipboard manager with history
if command -v cliphist >/dev/null 2>&1; then
    cliphist list | wofi --dmenu --prompt "Clipboard History" --width 800 --height 400 | cliphist decode | wl-copy
else
    notify-send "Clipboard Manager" "cliphist not installed. Install with: sudo pacman -S cliphist"
fi