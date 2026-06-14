---
title: Controls
description: The dot omarchy desktop controls menu.
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
