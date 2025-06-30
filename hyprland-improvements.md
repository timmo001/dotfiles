# Hyprland Experience Improvements

## Overview
Your current Hyprland setup is already quite sophisticated with excellent NVIDIA support, multi-monitor configuration, and comprehensive window rules. This document outlines targeted improvements to enhance productivity, aesthetics, and workflow efficiency.

## Current Setup Analysis
- **Strengths**: Excellent NVIDIA configuration, sophisticated window rules, good automation scripts, comprehensive keybindings
- **Areas for Enhancement**: Animation refinements, workspace management, productivity features, idle management

## 🎯 Priority Improvements

### 1. Enhanced Animation System
**Current**: Basic animations with single bezier curve
**Improvement**: More sophisticated, context-aware animations

```ini
# Enhanced bezier curves for different contexts
bezier = easeOutQuint, 0.23, 1, 0.32, 1
bezier = easeInOutCubic, 0.65, 0, 0.35, 1
bezier = overshot, 0.05, 0.9, 0.1, 1.05
bezier = smoothOut, 0.36, 0, 0.66, -0.56
bezier = smoothIn, 0.25, 1, 0.5, 1

# Context-specific animations
animation = windows, 1, 5, easeOutQuint, slide
animation = windowsOut, 1, 4, smoothOut, slide
animation = windowsMove, 1, 4, easeInOutCubic
animation = border, 1, 10, easeOutQuint
animation = borderangle, 1, 8, easeOutQuint
animation = fade, 1, 4, easeOutQuint
animation = workspaces, 1, 6, easeOutQuint, slidevert
animation = specialWorkspace, 1, 5, easeOutQuint, slidevert
```

### 2. Advanced Workspace Management
**Current**: Static workspace assignments
**Improvement**: Dynamic workspace management with better organization

```ini
# Enhanced workspace rules with better organization
workspace = 1, name:󰈹 Browser, monitor:DP-2, default:true, persistent:true
workspace = 2, name:󰨞 Development, monitor:HDMI-A-1, persistent:true
workspace = 3, name: Terminal, monitor:HDMI-A-1, persistent:true
workspace = 4, name:󰙯 Communication, monitor:DP-2, persistent:true
workspace = 5, name:󰊴 Gaming, monitor:HDMI-A-1, persistent:true
workspace = 6, name:󰎆 Media, monitor:HDMI-A-1, persistent:true
workspace = 7, name:󰈙 Files, monitor:HDMI-A-1, persistent:true
workspace = 8, name:󰍉 System, monitor:HDMI-A-1, persistent:true
workspace = 9, name:󰌢 Overflow, monitor:HDMI-A-1, persistent:true
workspace = 10, name:󰐃 Scratch, monitor:HDMI-A-1, persistent:true
```

### 3. Improved Window Rules & Management
**Current**: Good basic rules
**Improvement**: More sophisticated window behavior

```ini
# Enhanced floating window rules with better sizing
windowrulev2 = float, class:^(pavucontrol|blueman-manager|nm-applet)$
windowrulev2 = size 800 600, class:^(pavucontrol)$
windowrulev2 = center, class:^(pavucontrol)$

# Smart opacity rules for better focus indication
windowrulev2 = opacity 0.9 0.7, class:^(code|codium|cursor)$
windowrulev2 = opacity 1.0 0.8, class:^(firefox|zen)$
windowrulev2 = opacity 0.95 0.8, class:^(discord|slack)$

# Improved picture-in-picture handling
windowrulev2 = float, title:^(Picture-in-Picture)$
windowrulev2 = pin, title:^(Picture-in-Picture)$
windowrulev2 = size 25% 25%, title:^(Picture-in-Picture)$
windowrulev2 = move 74% 4%, title:^(Picture-in-Picture)$
windowrulev2 = keepaspectratio, title:^(Picture-in-Picture)$
```

### 4. Enhanced Productivity Keybindings
**Current**: Good basic keybindings
**Improvement**: Advanced workflow shortcuts

```ini
# Advanced window management
bind = $mainMod SHIFT, left, movewindow, l
bind = $mainMod SHIFT, right, movewindow, r
bind = $mainMod SHIFT, up, movewindow, u
bind = $mainMod SHIFT, down, movewindow, d

# Window resizing with vim keys
bind = $mainMod CTRL, h, resizeactive, -50 0
bind = $mainMod CTRL, l, resizeactive, 50 0
bind = $mainMod CTRL, k, resizeactive, 0 -50
bind = $mainMod CTRL, j, resizeactive, 0 50

# Quick workspace switching (next/prev)
bind = $mainMod, TAB, workspace, m+1
bind = $mainMod SHIFT, TAB, workspace, m-1

# Focus urgent window
bind = $mainMod, U, focusurgent

# Center floating window
bind = $mainMod SHIFT, C, centerwindow

# Toggle window split
bind = $mainMod, R, togglesplit

# Pin window (show on all workspaces)
bind = $mainMod SHIFT, P, pin
```

### 5. Scratchpad Enhancement
**Current**: Basic scratchpad
**Improvement**: Multiple specialized scratchpads

```ini
# Multiple scratchpads for different purposes
bind = $mainMod, grave, togglespecialworkspace, dropdown
bind = $mainMod, F1, togglespecialworkspace, music
bind = $mainMod, F2, togglespecialworkspace, notes
bind = $mainMod, F3, togglespecialworkspace, calculator

# Move windows to specific scratchpads
bind = $mainMod SHIFT, grave, movetoworkspace, special:dropdown
bind = $mainMod SHIFT, F1, movetoworkspace, special:music
bind = $mainMod SHIFT, F2, movetoworkspace, special:notes
bind = $mainMod SHIFT, F3, movetoworkspace, special:calculator
```

## 🔧 Configuration Enhancements

### 1. Improved Idle Management
**File**: `hypridle.conf`
**Enhancement**: Smarter power management with different profiles

```ini
general {
    lock_cmd = pidof hyprlock || hyprlock
    before_sleep_cmd = loginctl lock-session
    after_sleep_cmd = hyprctl dispatch dpms on
    ignore_dbus_inhibit = false
}

# Dim screen after 5 minutes
listener {
    timeout = 300
    on-timeout = brightnessctl -s set 10%
    on-resume = brightnessctl -r
}

# Lock screen after 10 minutes
listener {
    timeout = 600
    on-timeout = loginctl lock-session
}

# Turn off displays after 15 minutes
listener {
    timeout = 900
    on-timeout = hyprctl dispatch dpms off
    on-resume = hyprctl dispatch dpms on
}

# Suspend after 30 minutes (only on laptop)
listener {
    timeout = 1800
    on-timeout = [ $HOSTNAME != "desktop" ] && systemctl suspend
}
```

### 2. Enhanced Performance Settings
**Current**: Good NVIDIA setup
**Improvement**: Optimized for high refresh rate gaming

```ini
# Performance optimizations
render {
    explicit_sync = 2
    explicit_sync_kms = 2
    direct_scanout = 1
    cm_fs_passthrough = 1
}

# Optimized for gaming
misc {
    disable_hyprland_logo = true
    disable_splash_rendering = true
    vfr = true  # Variable refresh rate
    vrr = 1     # Variable refresh rate for games
    mouse_move_enables_dpms = true
    enable_swallow = true
    swallow_regex = ^(ghostty|kitty|alacritty)$
    focus_on_activate = false
    initial_workspace_tracking = 0
    middle_click_paste = false
    allow_session_lock_restore = true
}
```

### 3. Smart Blur Configuration
**Current**: Basic blur
**Improvement**: Context-aware blur with performance optimization

```ini
decoration {
    rounding = 12

    blur {
        enabled = true
        size = 8
        passes = 3
        new_optimizations = true
        xray = true
        noise = 0.0117
        contrast = 1.3
        brightness = 1.0
        vibrancy = 0.2
        vibrancy_darkness = 0.5
        
        # Blur specific elements
        popups = true
        popups_ignorealpha = 0.2
    }

    drop_shadow = true
    shadow_range = 20
    shadow_render_power = 3
    shadow_offset = 0 2
    col.shadow = rgba(00000099)
    col.shadow_inactive = rgba(00000066)
}
```

## 🚀 New Features to Add

### 1. Clipboard Manager Integration
**Script**: `~/.config/hypr/scripts/clipboard-manager.sh`

```bash
#!/bin/bash
# Enhanced clipboard manager with history
if command -v cliphist >/dev/null 2>&1; then
    cliphist list | wofi --dmenu --prompt "Clipboard" | cliphist decode | wl-copy
else
    notify-send "Clipboard Manager" "cliphist not installed"
fi
```

**Keybinding**:
```ini
bind = $mainMod, INSERT, exec, ~/.config/hypr/scripts/clipboard-manager.sh
```

### 2. Window Switcher
**Script**: `~/.config/hypr/scripts/window-switcher.sh`

```bash
#!/bin/bash
# Advanced window switcher with preview
hyprctl clients -j | jq -r '.[] | "\(.class) - \(.title) (\(.workspace.name))"' | \
wofi --dmenu --prompt "Switch to" | \
while read -r line; do
    class=$(echo "$line" | cut -d' ' -f1)
    hyprctl dispatch focuswindow "class:$class"
done
```

**Keybinding**:
```ini
bind = $mainMod, O, exec, ~/.config/hypr/scripts/window-switcher.sh
```

### 3. Smart Screenshot Tool
**Script**: `~/.config/hypr/scripts/smart-screenshot.sh`

```bash
#!/bin/bash
# Smart screenshot with multiple options
choice=$(echo -e "󰹑 Screen\n󰩭 Area\n󰖟 Window\n󰄀 Delayed (5s)" | wofi --dmenu --prompt "Screenshot")

case "$choice" in
    "󰹑 Screen") grimblast --notify copy screen ;;
    "󰩭 Area") grimblast --notify copy area ;;
    "󰖟 Window") grimblast --notify copy active ;;
    "󰄀 Delayed (5s)") sleep 5 && grimblast --notify copy screen ;;
esac
```

**Keybinding**:
```ini
bind = $mainMod SHIFT, S, exec, ~/.config/hypr/scripts/smart-screenshot.sh
```

### 4. Workspace Launcher
**Script**: `~/.config/hypr/scripts/workspace-launcher.sh`

```bash
#!/bin/bash
# Quick workspace navigation with descriptions
workspaces="1 󰈹 Browser
2 󰨞 Development  
3  Terminal
4 󰙯 Communication
5 󰊴 Gaming
6 󰎆 Media
7 󰈙 Files
8 󰍉 System
9 󰌢 Overflow
10 󰐃 Scratch"

selected=$(echo "$workspaces" | wofi --dmenu --prompt "Go to workspace")
if [ -n "$selected" ]; then
    workspace_num=$(echo "$selected" | cut -d' ' -f1)
    hyprctl dispatch workspace "$workspace_num"
fi
```

**Keybinding**:
```ini
bind = $mainMod, slash, exec, ~/.config/hypr/scripts/workspace-launcher.sh
```

## 🎨 Visual Enhancements

### 1. Enhanced Border Colors
```ini
general {
    col.active_border = rgba(cba6f7ff) rgba(89b4faff) rgba(94e2d5ff) 45deg
    col.inactive_border = rgba(6c7086ff)
    col.nogroup_border = rgba(f38ba8ff)
    col.nogroup_border_active = rgba(f9e2afff)
}
```

### 2. Improved Group Styling
```ini
group {
    col.border_active = rgba(cba6f7ff) rgba(f9e2afff) 45deg
    col.border_inactive = rgba(6c7086ff)
    col.border_locked_active = rgba(f38ba8ff)
    col.border_locked_inactive = rgba(585b70ff)
    
    groupbar {
        enabled = true
        font_family = CaskaydiaCove Nerd Font
        font_size = 12
        gradients = true
        render_titles = true
        scrolling = true
        text_color = rgba(cdd6f4ff)
        col.active = rgba(cba6f7ff)
        col.inactive = rgba(6c7086ff)
        col.locked_active = rgba(f38ba8ff)
        col.locked_inactive = rgba(585b70ff)
    }
}
```

## 📱 Waybar Enhancements

### 1. Additional Modules
Add these to your Waybar configuration:

```json
"modules-right": [
    "custom/weather",
    "custom/updates",
    "custom/mic-status",
    "pulseaudio",
    "cpu",
    "memory",
    "custom/gpu-usage",
    "disk",
    "temperature",
    "network",
    "backlight",
    "battery",
    "custom/clock-ordinal",
    "tray",
    "custom/powermenu"
]
```

### 2. Weather Module
```json
"custom/weather": {
    "format": "{}",
    "exec": "~/.config/waybar/scripts/weather.sh",
    "interval": 1800,
    "return-type": "json",
    "tooltip": true
}
```

## 🔄 Implementation Priority

1. **High Priority** (Immediate improvements):
   - Enhanced animations
   - Improved keybindings
   - Smart blur configuration

2. **Medium Priority** (This week):
   - Workspace management improvements
   - Additional scripts (clipboard, window switcher)
   - Idle management enhancements

3. **Low Priority** (Nice to have):
   - Visual enhancements
   - Waybar additional modules
   - Advanced window rules

## 🛠️ Installation Notes

- Most improvements can be added incrementally
- Test animations on your hardware for performance impact
- Some scripts require additional dependencies (`jq`, `cliphist`)
- Consider creating a backup of your current configuration

## 📋 Dependencies to Install

```bash
# Additional tools for enhanced functionality
sudo pacman -S jq cliphist wl-clipboard brightnessctl
# or equivalent for your distribution
```

This improvement plan focuses on enhancing your already excellent setup with modern productivity features, better visual feedback, and smarter automation while maintaining the stability and performance you currently enjoy.