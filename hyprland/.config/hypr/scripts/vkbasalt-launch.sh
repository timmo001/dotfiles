#!/bin/bash
# vkBasalt launcher script for Hyprland color correction
# Based on display color profiles extracted with color-from-edid.sh

# Check if app name is provided
if [ $# -lt 1 ]; then
    echo "Usage: $0 <application> [application arguments]"
    echo "Example: $0 steam"
    echo "Optional: Set VKBASALT_CONFIG_FILE environment variable to use a specific config"
    exit 1
fi

APP_NAME="$1"
shift  # Remove the first argument (app name) from the list

# Check if vkbasalt is installed
if ! ldconfig -p | grep -q libvkbasalt.so; then
    echo "Error: vkBasalt is not installed. Please install it first."
    echo "For Arch: sudo pacman -S vkbasalt"
    exit 1
fi

# Get monitor info for config file selection
if command -v hyprctl &> /dev/null; then
    MONITOR_INFO=$(hyprctl monitors -j | jq -r '.[0].name')
else
    echo "Warning: hyprctl not found, using generic config"
    MONITOR_INFO="default"
fi

# Check if a specific config file was provided
if [ -z "$VKBASALT_CONFIG_FILE" ]; then
    # Use monitor-specific config if it exists
    if [ -f "$HOME/.config/vkBasalt/${MONITOR_INFO}.conf" ]; then
        export VKBASALT_CONFIG_FILE="$HOME/.config/vkBasalt/${MONITOR_INFO}.conf"
    else
        # Create default config if not exists
        mkdir -p "$HOME/.config/vkBasalt"
        DEFAULT_CONFIG="$HOME/.config/vkBasalt/vkBasalt.conf"
        
        if [ ! -f "$DEFAULT_CONFIG" ]; then
            cat > "$DEFAULT_CONFIG" << EOL
# Default vkBasalt configuration
# To create monitor-specific configs, run ~/.config/hypr/scripts/color-from-edid.sh

# Enable effects
effects = cas:colorCorrection

# Contrast Adaptive Sharpening
cas_Sharpness = 0.4

# Color correction - default neutral values
colorCorrection_RedMatrix = 1.0, 0.0, 0.0
colorCorrection_GreenMatrix = 0.0, 1.0, 0.0
colorCorrection_BlueMatrix = 0.0, 0.0, 1.0
colorCorrection_Gamma = 2.2
EOL
        fi
        
        export VKBASALT_CONFIG_FILE="$DEFAULT_CONFIG"
    fi
fi

echo "Launching $APP_NAME with vkBasalt color correction"
echo "Using config: $VKBASALT_CONFIG_FILE"

# Enable vkBasalt
export ENABLE_VKBASALT=1

# Launch the application
"$APP_NAME" "$@"

exit_status=$?
if [ $exit_status -ne 0 ]; then
    echo "Application exited with status $exit_status"
    echo "If you're experiencing issues with vkBasalt, try:"
    echo "1. Run ~/.config/hypr/scripts/color-from-edid.sh to create monitor-specific configs"
    echo "2. Edit $VKBASALT_CONFIG_FILE manually for custom settings"
    echo "3. Disable vkBasalt by setting ENABLE_VKBASALT=0"
fi

exit $exit_status 