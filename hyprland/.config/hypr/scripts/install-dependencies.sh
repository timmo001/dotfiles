#!/bin/bash

# Install dependencies for enhanced Hyprland features
echo "Installing dependencies for enhanced Hyprland experience..."

# Detect package manager and install accordingly
if command -v pacman >/dev/null 2>&1; then
    echo "Detected Arch Linux - using pacman"
    sudo pacman -S --needed jq cliphist wl-clipboard brightnessctl
elif command -v apt >/dev/null 2>&1; then
    echo "Detected Debian/Ubuntu - using apt"
    sudo apt update
    sudo apt install -y jq wl-clipboard brightnessctl
    # Note: cliphist might need to be installed from source or AUR equivalent
    echo "Note: You may need to install cliphist manually"
elif command -v dnf >/dev/null 2>&1; then
    echo "Detected Fedora - using dnf"
    sudo dnf install -y jq wl-clipboard brightnessctl
    # Note: cliphist might need to be installed from source
    echo "Note: You may need to install cliphist manually"
elif command -v zypper >/dev/null 2>&1; then
    echo "Detected openSUSE - using zypper"
    sudo zypper install -y jq wl-clipboard brightnessctl
    echo "Note: You may need to install cliphist manually"
else
    echo "Package manager not detected. Please install manually:"
    echo "- jq (JSON processor)"
    echo "- cliphist (clipboard history manager)"
    echo "- wl-clipboard (Wayland clipboard utilities)"
    echo "- brightnessctl (brightness control)"
fi

echo "Dependencies installation completed!"
echo ""
echo "To enable clipboard history, make sure cliphist is running:"
echo "Add these to your Hyprland autostart if not already present:"
echo "exec-once = wl-paste --type text --watch cliphist store"
echo "exec-once = wl-paste --type image --watch cliphist store"