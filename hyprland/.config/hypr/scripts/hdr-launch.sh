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
shift # Remove the first argument (app name) from the list

# Check if gamescope is installed
if ! command -v gamescope &>/dev/null; then
    echo "Error: gamescope is not installed. Please install it first."
    echo "For Arch: sudo pacman -S gamescope"
    exit 1
fi

# List available GPUs
echo "Available GPUs:"
if command -v vulkaninfo &>/dev/null; then
    vulkaninfo | grep -A 2 "GPU id" | grep -E "GPU id|deviceName" | sed 's/^[[:space:]]*//'
elif command -v lspci &>/dev/null; then
    lspci | grep -E 'VGA|3D|Display'
fi

# Explicitly use HDMI-A-1 as requested
MONITOR_INFO="HDMI-A-1"

# Get monitor resolution
if command -v hyprctl &>/dev/null; then
    MONITOR_RES=$(hyprctl monitors -j | jq -r '.[] | select(.name=="HDMI-A-1") | "\(.width)x\(.height)"')
    if [ -z "$MONITOR_RES" ]; then
        echo "Warning: Could not find HDMI-A-1 monitor, using default resolution"
        MONITOR_RES="3840x2160"
    fi
else
    echo "Warning: hyprctl not found, using default resolution"
    MONITOR_RES="3840x2160"
fi

echo "Launching $APP_NAME with HDR enabled on $MONITOR_INFO ($MONITOR_RES)"

# Environment variables for HDR
export ENABLE_HDR_WSI=1
export DXVK_HDR=1
export MANGOHUD_CONFIG="position=top-left,font_size=24,fps,frametime,gpu_stats,cpu_stats,ram,gpu_temp,cpu_temp,hdr"

# If NVIDIA GPU is detected, try to use it preferentially
if lspci | grep -i nvidia &>/dev/null; then
    GPU_OPTION="--prefer-vk-device nvidia"
    echo "Found NVIDIA GPU, will try to use it preferentially"
# Otherwise, if you have a specific AMD card you want to use, uncomment and modify this
# elif lspci | grep -i "AMD Radeon RX" &> /dev/null; then
#     GPU_OPTION="--prefer-vk-device amd"
#     echo "Found AMD discrete GPU, will try to use it preferentially"
else
    GPU_OPTION=""
fi

# Launch with gamescope using HDR
# Found the available HDR options in help:
# --hdr-enabled          - enable HDR output
# --hdr-itm-enabled      - enable inverse tone mapping for SDR content
# --hdr-sdr-content-nits - set SDR content brightness (default 400 nits)
# --hdr-itm-target-nits  - set target brightness (default 1000 nits, max 10000)
gamescope \
    -w ${MONITOR_RES%x*} -h ${MONITOR_RES#*x} \
    -r 0 \
    -O HDMI-A-1 \
    $GPU_OPTION \
    --hdr-enabled \
    --hdr-itm-enabled \
    --hdr-sdr-content-nits 400 \
    --hdr-itm-target-nits 1000 \
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
    echo ""
    echo "You may need to install the HDR WSI layer for Vulkan applications:"
    echo "sudo pacman -S vk-hdr-layer"
    echo ""
    echo "To force a specific GPU, use --prefer-vk-device with either a GPU name or PCI ID"
    echo "Example: --prefer-vk-device nvidia or --prefer-vk-device 10de:2684"
fi

exit $exit_status
