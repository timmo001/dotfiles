#!/bin/bash
# Direct launcher script for launching game executables directly
# This bypasses Steam without using HDR

if [ $# -lt 1 ]; then
    echo "Usage: $0 /path/to/game_executable [game arguments]"
    echo "Example: $0 ~/.steam/steam/steamapps/common/CyberPunk2077/bin/x64/Cyberpunk2077.exe"
    exit 1
fi

GAME_PATH="$1"
shift

# Set necessary environment variables for NVIDIA
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/nvidia_icd.json
export __VK_LAYER_NV_optimus=NVIDIA_only
export __GLX_VENDOR_LIBRARY_NAME=nvidia
export __GL_GSYNC_ALLOWED=1

# Explicitly use the NVIDIA GPU by PCI ID
NVIDIA_PCI_ID="10de:2704"  # Update this for your RTX 4080 SUPER if needed

# Kill any existing Xwayland processes on display :2
XWAYLAND_PID=$(pgrep -f "Xwayland :2")
if [ ! -z "$XWAYLAND_PID" ]; then
    echo "Killing existing Xwayland process on :2 (PID: $XWAYLAND_PID)"
    kill $XWAYLAND_PID 2>/dev/null
fi

echo "Launching $GAME_PATH"
echo "Using NVIDIA GPU with PCI ID $NVIDIA_PCI_ID"

# Launch with gamescope without HDR
gamescope \
    -w 3840 -h 2160 \
    -r 240 \
    -O HDMI-A-1 \
    --prefer-vk-device $NVIDIA_PCI_ID \
    --adaptive-sync \
    --borderless \
    --fullscreen \
    --display-index 0 \
    --xwayland-count 2 \
    -- "$GAME_PATH" "$@"

exit_code=$?
if [ $exit_code -ne 0 ]; then
    echo "Game exited with status $exit_code"
    echo ""
    echo "If you're having issues, try adding these environment variables to your Hyprland config:"
    echo "env = VK_ICD_FILENAMES,/usr/share/vulkan/icd.d/nvidia_icd.json"
    echo "env = __VK_LAYER_NV_optimus,NVIDIA_only"
    echo "env = VK_DRIVER_FILES,/usr/share/vulkan/icd.d/nvidia_icd.json"
fi

exit $exit_code 