---
title: Controls
description: The dot omarchy desktop controls menu.
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

## Power profiles

Power-profile control has two entrypoints:

- `dot omarchy power` opens the Omarchy power-profile submenu from the `dot` TUI.
- `SUPER+CTRL+P` runs `power-profile-menu`, a Walker picker that shows the current profile and selects one of the profiles reported by `omarchy-powerprofiles-list`.

The menu writes the selected profile with `powerprofilesctl set`, so the available choices and final state come from `power-profiles-daemon` rather than a dot-specific state file.

### Laptop automation

The `laptop` Hypr host starts `power-profile-daemon` from `~/.config/hypr/host/autostart.conf`. It replaces Omarchy's AC udev auto-switching, which otherwise forces `performance` on AC.

On laptops, the daemon keeps the profile conservative by default:

- Startup sets `balanced`, unless the machine is on battery during the 01:00-07:00 local night window or below 20% battery.
- Unplugging from AC drops `performance` to `balanced`; it leaves existing `balanced` and `power-saver` choices alone.
- Plugging into AC relaxes `power-saver` back to `balanced`; it leaves `balanced` and `performance` alone.
- While on battery, the daemon switches to `power-saver` once when the night window starts or when battery drops below 20%.
- Manual changes after an automatic night switch are respected. At the end of the night window, the daemon only returns to `balanced` if it is still on the auto-applied `power-saver` profile and the battery is not below the low threshold.

The daemon keeps a single-instance pidfile under `${XDG_RUNTIME_DIR:-/tmp}/power-profile-daemon.pid` and polls AC/time/battery state every two seconds. It sends best-effort desktop notifications through `notify-send`.

### Troubleshooting

Use the underlying tools to verify state before changing the dotfiles:

```bash
powerprofilesctl get
omarchy-powerprofiles-list
pgrep -af power-profile-daemon
```

If `SUPER+CTRL+P` opens no choices, check that `omarchy-powerprofiles-list` prints profile IDs. If the laptop policy is not running, confirm the active host symlink points at the laptop overrides and that Hyprland sourced `~/.config/hypr/host/autostart.conf`; see [Host Overrides](/omarchy/host-overrides/).
