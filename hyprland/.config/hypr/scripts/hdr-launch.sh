#!/bin/bash
# HDR launcher script for Hyprland
# Based on KDE Plasma's HDR implementation and NVIDIA forum recommendations
# This script launches applications with HDR support using gamescope

# Check if app name is provided
if [ $# -lt 1 ]; then
    echo "Usage: $0 <application> [application arguments]"
    echo "Example: $0 steam"
    exit 1
fi

APP_NAME="$1"
shift  # Remove the first argument (app name) from the list

# Check if gamescope is installed
if ! command -v gamescope &> /dev/null; then
    echo "Error: gamescope is not installed. Please install it first."
    echo "For Arch: sudo pacman -S gamescope"
    exit 1
fi

# Get monitor info
if command -v hyprctl &> /dev/null; then
    MONITOR_INFO=$(hyprctl monitors -j | jq -r '.[0].name')
    MONITOR_RES=$(hyprctl monitors -j | jq -r '.[0].width,.[0].height' | tr '\n' 'x' | sed 's/x$//')
else
    echo "Warning: hyprctl not found, using default resolution"
    MONITOR_RES="3840x2160"
fi

echo "Launching $APP_NAME with HDR enabled on $MONITOR_INFO ($MONITOR_RES)"

# Environment variables for HDR
export ENABLE_HDR_WSI=1
export DXVK_HDR=1
export MANGOHUD_CONFIG="position=top-left,font_size=24,fps,frametime,gpu_stats,cpu_stats,ram,gpu_temp,cpu_temp,hdr"

# Launch with gamescope using HDR
# -r 0 = use app's refresh rate
# --hdr10 = enable HDR10 support
# --adaptive-sync = enable variable refresh rate if available
gamescope \
    -w ${MONITOR_RES%x*} -h ${MONITOR_RES#*x} \
    -r 0 \
    --hdr10 \
    --adaptive-sync \
    --borderless \
    --fullscreen \
    -- "$APP_NAME" "$@"

exit_status=$?
if [ $exit_status -ne 0 ]; then
    echo "Application exited with status $exit_status"
    echo "If you're experiencing issues with HDR, try the following:"
    echo "1. For NVIDIA: Make sure you have driver version 550.54.14 or higher"
    echo "2. For AMD: Make sure you have the latest mesa and kernel"
    echo "3. Add 'wide_color_gamut = true' to your hyprland.conf experimental section"
fi

exit $exit_status 