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
shift # Remove the first argument (app name) from the list

# Check if gamescope is installed
if ! command -v gamescope &>/dev/null; then
    echo "Error: gamescope is not installed. Please install it first."
    echo "For Arch: sudo pacman -S gamescope"
    exit 1
fi

# List available GPUs
echo "Available GPUs:"
if command -v lspci &>/dev/null; then
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

echo "Launching $APP_NAME on $MONITOR_INFO ($MONITOR_RES)"

# Function to clean up existing processes
cleanup_processes() {
    # Kill any existing gamescope processes to avoid conflicts
    if pgrep -f "gamescope" | grep -v $$ >/dev/null; then
        echo "Killing existing gamescope processes"
        for pid in $(pgrep -f "gamescope" | grep -v $$); do
            echo "Killing gamescope process: $pid"
            kill -15 $pid 2>/dev/null || true
        done
        sleep 1
    fi

    # Kill any existing Xwayland processes that might conflict
    for display in 0 1 2 3 4 5 6; do
        XWAYLAND_PID=$(pgrep -f "Xwayland :$display")
        if [ ! -z "$XWAYLAND_PID" ]; then
            echo "Killing existing Xwayland process on :$display (PID: $XWAYLAND_PID)"
            kill -15 $XWAYLAND_PID 2>/dev/null || true
        fi
    done

    # Additional time for processes to terminate
    sleep 1
}

# Set up cleanup trap
cleanup_on_exit() {
    echo "Cleaning up processes on exit..."
    SELF_PID=$$
    for pid in $(pgrep -f "gamescope" | grep -v $SELF_PID); do
        echo "Terminating gamescope process: $pid"
        kill -15 $pid 2>/dev/null || true
    done
}

# Register the cleanup function to run on specific signals
trap cleanup_on_exit INT TERM QUIT

# Environment variables for NVIDIA
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/nvidia_icd.json
export __VK_LAYER_NV_optimus=NVIDIA_only
export __GLX_VENDOR_LIBRARY_NAME=nvidia
export __GL_GSYNC_ALLOWED=1
export MANGOHUD_CONFIG="position=top-left,font_size=24,fps,frametime,gpu_stats,cpu_stats,ram,gpu_temp,cpu_temp"

# Function to find an available X display and ensure its socket is available
find_available_display() {
    for display in 20 21 22 23 24 25; do
        if ! pgrep -f "Xwayland :$display" >/dev/null; then
            # Check if socket exists and remove it
            SOCKET_PATH="/tmp/.X11-unix/X$display"
            if [ -e "$SOCKET_PATH" ]; then
                echo "Removing stale X11 socket: $SOCKET_PATH"
                rm -f "$SOCKET_PATH" 2>/dev/null || true
            fi

            # Also check abstract socket namespace
            if ss -xl | grep -q "@/tmp/.X11-unix/X$display"; then
                echo "Warning: Abstract socket for display :$display in use, trying another"
                continue
            fi

            echo $display
            return
        fi
    done
    echo "25" # Default to 25 if all others are occupied
}

# Clean up existing processes before launch
cleanup_processes

# Find available display
DISPLAY_NUM=$(find_available_display)
echo "Using X display :$DISPLAY_NUM for gamescope"

# Set NVIDIA-specific GPU option with exact PCI ID
NVIDIA_PCI_ID="10de:2704" # This is for RTX 4080 SUPER, update if needed
GPU_OPTION="--prefer-vk-device $NVIDIA_PCI_ID"
echo "Using NVIDIA GPU with PCI ID $NVIDIA_PCI_ID"

# Launch with gamescope (no HDR)
echo "Starting gamescope..."
XDG_RUNTIME_DIR="/run/user/$(id -u)" \
WAYLAND_DISPLAY="" \
XDG_SESSION_TYPE="x11" \
DISPLAY=":$DISPLAY_NUM" \
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
