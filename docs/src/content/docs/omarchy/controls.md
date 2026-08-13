---
title: Controls
description: The dot omarchy desktop controls menu and local keybindings.
sidebar:
  order: 3
---

## `dot omarchy`

Opens the Omarchy desktop controls menu. Pass a submenu path to jump straight to it, or chain a path to execute an action directly.

```bash
dot omarchy              # open the controls menu (TUI)
dot omarchy theme        # jump to the Theme submenu
dot omarchy theme set    # execute theme set directly
```

## Available submenus

| Submenu | Controls |
| --- | --- |
| `theme` | Theme management |
| `font` | Font management |
| `toggle` | Toggle system features |
| `capture` | Screenshots and recordings |
| `system` | Lock, logout, reboot, shutdown |
| `launch` | Launch applications |
| `refresh` | Refresh system components |
| `restart` | Restart system services |
| `install` | Install software and tools |
| `remove` | Remove software and features |
| `packages` | Package management |
| `share` | Share clipboard, files, folders |
| `reminder` | Reminders |
| `setup` | DNS, security setup |
| `snapshot` | System snapshots |
| `brightness` | Display and keyboard brightness |
| `power` | Power profiles |

:::tip
When restarting Omarchy-managed apps, prefer `omarchy restart <app>` (via the `restart` submenu) over manual process kills.
:::

## Keybinding overrides

The shared Hyprland config loads after Omarchy's defaults. It replaces these default bindings:

| Binding | Omarchy default | Local action |
| --- | --- | --- |
| `SUPER+TAB` | Next workspace | Apply a saved [workspace layout](/knowledge-base/workspace-relayout/) |
| `SUPER+ALT+TAB` | Next grouped window | Edit workspace layout presets |
| `CTRL+ALT+TAB` | Focus next monitor | Unbound in Hyprland; available to applications such as Ghostty |
| `CTRL+ALT+SHIFT+TAB` | Focus previous monitor | Unbound in Hyprland; available to applications such as Ghostty |
| `SUPER+SHIFT+F` | File manager | Add the active application to the floating rules |
| `SUPER+RETURN` | Omarchy terminal launcher | Open host-configured Ghostty in the active terminal directory |
| `SUPER+SHIFT+B` | Browser | Open a private personal Chromium window |
| `SUPER+CTRL+ALT+T` | Local time notification | Show local and US time zones |
| `SUPER+ALT+-` / `SUPER+ALT+=` | Resize width by 25 | Resize width by 2 |
| `SUPER+ALT+SHIFT+-` / `SUPER+ALT+SHIFT+=` | Resize height by 25 | Resize height by 2 |

The config also redirects `CTRL+SHIFT+T`, `CTRL+SHIFT+W`, `CTRL+TAB`, and `CTRL+SHIFT+TAB` to Herdr tab actions while Ghostty is active. Other applications receive the original key event.

Custom bindings that conflicted with Quattro defaults use these chords instead:

| Binding | Local action | Avoided default |
| --- | --- | --- |
| `SUPER+CTRL+ALT+P` | Power profile menu | Power panel on `SUPER+CTRL+P` |
| `SUPER+CTRL+SHIFT+S` | Slack | Google Maps on `SUPER+SHIFT+S` |
| `SUPER+ALT+X` | X notifications | Universal cut on `SUPER+X` and X on `SUPER+SHIFT+X` |
| `SUPER+CTRL+ALT+G` | GitHub notifications | Move window out of group on `SUPER+ALT+G` |
| `SUPER+CTRL+SHIFT+C` | Toggle in-call automation | Calendar on `SUPER+SHIFT+C` |
| `SUPER+CTRL+SHIFT+M` | Toggle microphone mute | Music on `SUPER+SHIFT+M` |
| `SUPER+CTRL+SHIFT+B` | Reconnect laptop Bluetooth headphones | Battery status on `SUPER+CTRL+ALT+B` |

`CTRL+ALT+H` toggles the Home Assistant dashboard panel from the Omarchy bar.
`CTRL+ALT+G` toggles the unified Git panel from the Omarchy bar.

The config leaves Quattro's native `SUPER+W` close-window, `SUPER+SHIFT+RETURN` browser, `SUPER+ALT+RETURN` Tmux, and `SUPER+SHIFT+/` 1Password bindings in place. Application defaults such as Tmux and 1Password require Omarchy's preinstalled bindings to be enabled.

## Power profiles

Power-profile control has two entrypoints:

- `dot omarchy power` opens the Omarchy power-profile submenu from the `dot` TUI.
- `SUPER+CTRL+ALT+P` runs `power-profile-menu`, an Omarchy menu that shows the current profile and selects one of the profiles reported by `omarchy-powerprofiles-list`.

The menu writes the selected profile with `powerprofilesctl set`, so the available choices and final state come from `power-profiles-daemon` rather than a dot-specific state file.

### Laptop automation

The `laptop` Hypr host starts `power-profile-daemon` from `~/.config/hypr/host/autostart.lua`. It replaces Omarchy's AC udev auto-switching, which otherwise forces `performance` on AC.

On laptops, the daemon keeps the profile conservative by default:

- Startup sets `balanced`, unless the machine is on battery during the 01:00-07:00 local night window or below 20% battery.
- Unplugging from AC drops `performance` to `balanced`; it leaves existing `balanced` and `power-saver` choices alone.
- Plugging into AC relaxes `power-saver` back to `balanced`; it leaves `balanced` and `performance` alone.
- While on battery, the daemon switches to `power-saver` once when the night window starts or when battery drops below 20%.
- Manual changes after an automatic night switch are respected. At the end of the night window, the daemon only returns to `balanced` if it is still on the auto-applied `power-saver` profile and the battery is not below the low threshold.

The daemon keeps a single-instance pidfile under `${XDG_RUNTIME_DIR:-/tmp}/power-profile-daemon.pid` and polls AC/time/battery state every two seconds. It sends best-effort desktop notifications through `omarchy notification send`.

### Troubleshooting

Use the underlying tools to verify state before changing the dotfiles:

```bash
powerprofilesctl get
omarchy-powerprofiles-list
pgrep -af power-profile-daemon
```

If `SUPER+CTRL+ALT+P` opens no choices, check that `omarchy-powerprofiles-list` prints profile IDs. If the laptop policy is not running, confirm the active host symlink points at the laptop overrides and that Hyprland loaded `~/.config/hypr/host/autostart.lua`; see [Host Overrides](/omarchy/host-overrides/).
