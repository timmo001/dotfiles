#!/bin/bash
# Standard launcher script for Hyprland
# This script launches applications using gamescope without HDR support

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

# List available GPUs
echo "Available GPUs:"
if command -v lspci &> /dev/null; then
    lspci | grep -E 'VGA|3D|Display'
fi

# Explicitly use HDMI-A-1 as requested
MONITOR_INFO="HDMI-A-1"

# Get monitor resolution
if command -v hyprctl &> /dev/null; then
    MONITOR_RES=$(hyprctl monitors -j | jq -r '.[] | select(.name=="HDMI-A-1") | "\(.width)x\(.height)"')
    if [ -z "$MONITOR_RES" ]; then
        echo "Warning: Could not find HDMI-A-1 monitor, using default resolution"
        MONITOR_RES="3840x2160"
    fi
else
    echo "Warning: hyprctl not found, using default resolution"
    MONITOR_RES="3840x2160"
fi

echo "Launching $APP_NAME on $MONITOR_INFO ($MONITOR_RES)"

# Environment variables for NVIDIA
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/nvidia_icd.json
export __VK_LAYER_NV_optimus=NVIDIA_only
export __GLX_VENDOR_LIBRARY_NAME=nvidia
export __GL_GSYNC_ALLOWED=1
export MANGOHUD_CONFIG="position=top-left,font_size=24,fps,frametime,gpu_stats,cpu_stats,ram,gpu_temp,cpu_temp"

# Set NVIDIA-specific GPU option with exact PCI ID
NVIDIA_PCI_ID="10de:2704"  # This is for RTX 4080 SUPER, update if needed
GPU_OPTION="--prefer-vk-device $NVIDIA_PCI_ID"
echo "Using NVIDIA GPU with PCI ID $NVIDIA_PCI_ID"

# Kill any existing Xwayland processes on display :2 to avoid port conflicts
XWAYLAND_PID=$(pgrep -f "Xwayland :2")
if [ ! -z "$XWAYLAND_PID" ]; then
    echo "Killing existing Xwayland process on :2 (PID: $XWAYLAND_PID)"
    kill $XWAYLAND_PID 2>/dev/null
fi

# Launch with gamescope (no HDR)
gamescope \
    -w ${MONITOR_RES%x*} -h ${MONITOR_RES#*x} \
    -r 240 \
    -O HDMI-A-1 \
    $GPU_OPTION \
    --adaptive-sync \
    --borderless \
    --fullscreen \
    --display-index 0 \
    --xwayland-count 2 \
    -- "$APP_NAME" "$@"

exit_status=$?
if [ $exit_status -ne 0 ]; then
    echo "Application exited with status $exit_status"
    echo "If you're experiencing issues, try the following:"
    echo "1. For NVIDIA: Make sure you have the latest drivers"
    echo ""
    echo "Debug GPU selection with environmental variables:"
    echo "VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/nvidia_icd.json"
    echo "__VK_LAYER_NV_optimus=NVIDIA_only"
fi

exit $exit_status 