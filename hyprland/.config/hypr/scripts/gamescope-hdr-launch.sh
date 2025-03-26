#!/bin/bash
# HDR launcher script for Hyprland
# Based on KDE Plasma's HDR implementation and NVIDIA forum recommendations
# This script launches applications with HDR support using gamescope

# Process flags
SKIP_NESTED=0
ARGS=()
for arg in "$@"; do
    if [ "$arg" = "--no-nested" ]; then
        SKIP_NESTED=1
    else
        ARGS+=("$arg")
    fi
done

# Restore arguments without our custom flags
set -- "${ARGS[@]}"

# Check if app name is provided
if [ $# -lt 1 ]; then
    echo "Usage: $0 [options] <application> [application arguments]"
    echo "Options:"
    echo "  --no-nested     Skip nested mode even inside Hyprland"
    echo ""
    echo "Example: $0 steam"
    echo "Example: $0 --no-nested steam"
    exit 1
fi

# Check if proprietary NVIDIA driver is loaded (not nouveau)
if lsmod | grep -q nouveau; then
    echo "Warning: nouveau driver is loaded. For best HDR experience, use the proprietary NVIDIA driver."
    echo "You can blacklist nouveau by creating a file in /etc/modprobe.d/"
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if nvidia module is loaded
if ! lsmod | grep -q nvidia; then
    echo "Warning: NVIDIA driver module not loaded. HDR may not work correctly."
    echo "Try running: sudo modprobe nvidia"
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check NVIDIA driver version
NVIDIA_VERSION=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null)
if [ -n "$NVIDIA_VERSION" ]; then
    REQUIRED_VERSION="550.54.14"
    if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NVIDIA_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
        echo "Warning: NVIDIA driver version $NVIDIA_VERSION is below required version $REQUIRED_VERSION"
        echo "HDR support may not work correctly. Please update your NVIDIA drivers."
        read -p "Continue anyway? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        echo "NVIDIA driver version $NVIDIA_VERSION meets requirements"
    fi
fi

APP_NAME="$1"
shift # Remove the first argument (app name) from the list

# Check if gamescope is installed
if ! command -v gamescope &>/dev/null; then
    echo "Error: gamescope is not installed. Please install it first."
    echo "For Arch: sudo pacman -S gamescope"
    exit 1
fi

# Check for HDR WSI layer
if ! pacman -Q vk-hdr-layer-kwin6-git &>/dev/null; then
    echo "Warning: HDR WSI layer not found. This is required for HDR support."
    echo "You need to install vk-hdr-layer-kwin6-git from the AUR."
    echo "You can install it using your AUR helper, for example:"
    echo "yay -S vk-hdr-layer-kwin6-git"
    read -p "Continue without HDR WSI layer? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
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

echo "Launching $APP_NAME with HDR enabled on $MONITOR_INFO ($MONITOR_RES)"

# Report Vulkan information for debugging
if command -v vulkaninfo &>/dev/null; then
    echo "Available Vulkan drivers:"
    vulkaninfo --summary 2>/dev/null | grep -E "GPU|Driver" || echo "No Vulkan drivers found"
fi

# Environment variables for HDR and NVIDIA
export ENABLE_HDR_WSI=1
export DXVK_HDR=1

# NVIDIA driver configuration
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/nvidia_icd.json
export __VK_LAYER_NV_optimus=NVIDIA_only
export __GLX_VENDOR_LIBRARY_NAME=nvidia
export __GL_GSYNC_ALLOWED=1
export MANGOHUD_CONFIG="position=top-left,font_size=24,fps,frametime,gpu_stats,cpu_stats,ram,gpu_temp,cpu_temp,hdr"

# Force NVIDIA GPU and disable AMD
export VK_DRIVER_FILES=/usr/share/vulkan/icd.d/nvidia_icd.json
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/nvidia_icd.json
export DISABLE_LAYER_AMD_SWITCHABLE_GRAPHICS_1=1
export VK_INSTANCE_LAYERS=VK_LAYER_NV_optimus
export VK_LOADER_DRIVERS_SELECT=nvidia_icd
export VK_LOADER_LAYERS_ENABLE=1
export VK_LOADER_DEBUG=all

# EGL configuration for Xwayland
export LIBGL_DRIVERS_PATH=/usr/lib/dri:/usr/lib32/dri
export EGL_PLATFORM=x11
export GBM_BACKEND=nvidia-drm
export __GLX_VENDOR_LIBRARY_NAME=nvidia
export __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/10_nvidia.json
export EGL_LOG_LEVEL=debug
export LIBGL_DEBUG=verbose
export EGL_PLATFORM_DEVICE_EXT=1

# Add these new environment variables for Xwayland
export LIBGL_ALWAYS_INDIRECT=0
export MESA_LOADER_DRIVER_OVERRIDE=nvidia
export XDG_SESSION_TYPE=wayland
export GDK_BACKEND=wayland,x11

# Additional NVIDIA-specific variables
export __GL_VRR_ALLOWED=1
export __GL_MaxFramesAllowed=1
export NVD_BACKEND=direct
export PROTON_ENABLE_NGX_UPDATER=1
export __GL_SHADER_DISK_CACHE=1
export __GL_SHADER_DISK_CACHE_SKIP_CLEANUP=1

# Force use of the NVIDIA GPU
export DRI_PRIME=1
export __NV_PRIME_RENDER_OFFLOAD=1
export __GLX_PREFERRED_PROVIDER=NVIDIA-G0
export __GL_SYNC_DISPLAY_DEVICE=HDMI-A-1

# GLX configuration
export __GL_SYNC_TO_VBLANK=0
export __GL_YIELD=NOTHING
export __GL_THREADED_OPTIMIZATIONS=1

# Disable software rendering
export LIBGL_ALWAYS_SOFTWARE=0

# Check if we're running inside Hyprland
NESTED_FLAGS=""
if [ "$XDG_CURRENT_DESKTOP" = "Hyprland" ] && [ $SKIP_NESTED -eq 0 ]; then
    echo "Detected Hyprland session, will use nested mode"
    # Use proper nested parameters instead of ambiguous --nested flag
    NESTED_FLAGS="--nested-width ${MONITOR_RES%x*} --nested-height ${MONITOR_RES#*x} --nested-refresh 60"
elif [ $SKIP_NESTED -eq 1 ]; then
    echo "Detected Hyprland session, but nested mode explicitly disabled with --no-nested"
fi

# Find an available X display number
X_DISPLAY=10 # Start from a higher number to avoid conflicts
while [ -e "/tmp/.X11-unix/X$X_DISPLAY" ]; do
    X_DISPLAY=$((X_DISPLAY + 1))
done
echo "Using X display :$X_DISPLAY for Xwayland"

# Clean up any existing X11 sockets for our display
if [ -e "/tmp/.X11-unix/X$X_DISPLAY" ]; then
    echo "Removing existing X11 socket for display :$X_DISPLAY"
    sudo rm "/tmp/.X11-unix/X$X_DISPLAY"
fi

# Set environment variable to tell gamescope which X display to use
export GAMESCOPE_XWAYLAND_DISPLAY=$X_DISPLAY
export DISPLAY=:$X_DISPLAY

# If NVIDIA GPU is detected, try to use it preferentially
if lspci | grep -i nvidia &>/dev/null; then
    # Get NVIDIA GPU PCI ID for more specific targeting
    NVIDIA_PCI_ID=$(lspci | grep -i nvidia | head -n 1 | cut -d' ' -f1)
    if [ -n "$NVIDIA_PCI_ID" ]; then
        GPU_OPTION="--prefer-vk-device $NVIDIA_PCI_ID"
        echo "Found NVIDIA GPU at PCI ID $NVIDIA_PCI_ID, using it preferentially"
    else
        GPU_OPTION="--prefer-vk-device nvidia"
        echo "Found NVIDIA GPU, will try to use it preferentially"
    fi
# Otherwise, if you have a specific AMD card you want to use, uncomment and modify this
# elif lspci | grep -i "AMD Radeon RX" &> /dev/null; then
#     GPU_OPTION="--prefer-vk-device amd"
#     echo "Found AMD discrete GPU, will try to use it preferentially"
else
    GPU_OPTION=""
fi

# Launch with gamescope using HDR
gamescope \
    -w ${MONITOR_RES%x*} -h ${MONITOR_RES#*x} \
    -r 0 \
    -O HDMI-A-1 \
    $GPU_OPTION \
    $NESTED_FLAGS \
    --hdr-enabled \
    --hdr-itm-enabled \
    --hdr-sdr-content-nits 400 \
    --hdr-itm-target-nits 1000 \
    --adaptive-sync \
    --borderless \
    --fullscreen \
    --xwayland-count 1 \
    --rt \
    --expose-wayland \
    --prefer-output HDMI-A-1 \
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
    echo "sudo pacman -S vk-hdr-layer-kwin6-git"
    echo ""
    echo "If you see X server related errors, try:"
    echo "1. Close any other X11 applications"
    echo "2. Try a different --xwayland-count value (1-9)"
    echo ""
    echo "To force a specific GPU, use --prefer-vk-device with either a GPU name or PCI ID"
    echo "Example: --prefer-vk-device nvidia or --prefer-vk-device 10de:2684"
fi

exit $exit_status
