# Hyprland Configuration Improvements

## 🚀 What's Been Enhanced

Your Hyprland setup has been significantly improved with modern features and better productivity tools while maintaining your existing workflow.

## ✨ Key Improvements Made

### 1. **Enhanced Animations**
- **Before**: Basic single bezier curve animations
- **After**: Multiple sophisticated bezier curves for different contexts
- **Impact**: Smoother, more professional-looking transitions

### 2. **Advanced Blur & Visual Effects**
- **Before**: Simple 3px blur with 1 pass
- **After**: 8px blur with 3 passes, xray mode, vibrancy, and smart optimization
- **Impact**: More modern, polished appearance with better performance

### 3. **Improved Workspace Management**
- **Before**: Generic workspace names
- **After**: Icon-based descriptive names with persistent workspaces
- **Impact**: Better organization and visual clarity

### 4. **Enhanced Keybindings**
- Added window movement with SHIFT + arrow keys
- Added window resizing with CTRL + vim keys (hjkl)
- Added workspace cycling with TAB/SHIFT+TAB
- Added multiple scratchpads (F1-F3, backtick)
- **Impact**: Much more efficient window management

### 5. **Smart Idle Management**
- **Before**: Commented out idle settings
- **After**: Progressive power management (dim → lock → sleep → suspend)
- **Impact**: Better battery life and security

### 6. **Productivity Scripts**
Four new powerful scripts have been added:

#### 📋 Clipboard Manager (`Super + Insert`)
- Browse clipboard history with Wofi interface
- Requires: `cliphist`

#### 🪟 Window Switcher (`Super + O`)
- Quick window switching with preview
- Shows class, title, and workspace info
- Requires: `jq`

#### 📸 Smart Screenshot (`Super + Shift + S`)
- Multiple screenshot options in one menu
- Full screen, area, window, delayed, or save to file
- Enhanced with better notifications

#### 🏢 Workspace Launcher (`Super + /`)
- Visual workspace navigation with icons
- Quick jump to any workspace

### 7. **Enhanced Window Rules**
- Smart opacity for better focus indication
- Improved Picture-in-Picture positioning
- Better floating window management
- Enhanced application-specific rules

### 8. **Performance Optimizations**
- Enabled VRR (Variable Refresh Rate) for gaming
- Optimized rendering settings
- Better NVIDIA integration
- Improved terminal swallowing

## 🎯 New Keybindings

| Keybinding | Action |
|------------|--------|
| `Super + Insert` | Open clipboard history |
| `Super + O` | Window switcher |
| `Super + Shift + S` | Smart screenshot menu |
| `Super + /` | Workspace launcher |
| `Super + Tab` | Next workspace |
| `Super + Shift + Tab` | Previous workspace |
| `Super + U` | Focus urgent window |
| `Super + Shift + X` | Center floating window |
| `Super + R` | Toggle window split |
| `Super + Shift + P` | Pin window to all workspaces |
| `Super + Ctrl + H/J/K/L` | Resize window (vim keys) |
| `Super + Shift + ←/→/↑/↓` | Move window |
| `Super + F1/F2/F3` | Toggle scratchpads |
| `Super + \`` | Toggle dropdown scratchpad |

## 📦 Dependencies

Run the installation script to install required dependencies:
```bash
~/.config/hypr/scripts/install-dependencies.sh
```

Or install manually:
- `jq` - JSON processor for window switcher
- `cliphist` - Clipboard history manager
- `wl-clipboard` - Wayland clipboard utilities
- `brightnessctl` - Brightness control

## 🔧 Configuration Files Modified

- `hyprland.conf` - Main configuration with all enhancements
- `hypridle.conf` - Improved idle management
- New scripts in `scripts/` directory
- This README for documentation

## 🎨 Visual Changes

- **Rounding**: Increased from 8px to 12px
- **Blur**: Enhanced from basic to advanced with vibrancy
- **Shadows**: Improved drop shadows with better positioning
- **Borders**: Enhanced color gradients
- **Workspaces**: Icon-based naming for better visual organization

## 🚦 What's Backwards Compatible

- All your existing keybindings still work
- All your applications will open in the same workspaces
- Your autostart applications remain unchanged
- Your monitor configuration is preserved

## 🔄 Next Steps

1. **Test the new features**: Try the new keybindings and scripts
2. **Install dependencies**: Run the installation script if needed
3. **Customize further**: Adjust animations or blur if needed for performance
4. **Enjoy**: Experience the enhanced workflow!

## 🐛 Troubleshooting

- **Scripts not working**: Ensure they're executable and dependencies are installed
- **Animations too slow**: Reduce animation speeds in the config
- **Blur performance issues**: Reduce blur size or passes
- **Keybinding conflicts**: Check for conflicts with existing bindings

## 📚 Resources

- [Hyprland Wiki](https://wiki.hyprland.org/)
- [Full improvement documentation](../../../hyprland-improvements.md)
- Your original configuration is preserved with comments

---

*Enjoy your enhanced Hyprland experience! 🎉*