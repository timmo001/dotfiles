---
title: Shell (Quickshell)
description: The Omarchy 4 Quickshell shell, its generated shell.json, and the custom bar plugins.
---

Omarchy 4 replaces Waybar with a single long-running [Quickshell](https://quickshell.outfoxxed.me) process, `omarchy-shell`. That one process hosts the top bar, the notification daemon, the on-screen display, the launcher, and the settings panel. Restarting "the shell" restarts all of them together.

These dotfiles do not fork the shell. They extend it through supported user configuration: a generated `shell.json` that lays out the bar, a stowed `shell.toml` style override, and a small set of user plugins that the bar loads as extra widgets.

## Source of truth

Three things drive the bar, and none is hand-edited live:

- **`~/.config/omarchy/shell.json`** is generated, not stowed. `dot` renders it from Omarchy's shipped default and inserts the personal modules. The generator is `dot/src/lib/omarchyShellConfig.ts` (`mergeOmarchyShellConfig`). The live file is mode `0600` and tracked by neither dotfiles repo.
- **`~/.config/omarchy/shell.toml`** is stowed from `omarchy/.config/omarchy/shell.toml`. It keeps the shell-wide 12px type scale while setting the compact bar surface to 12px.
- **Bar plugins** live under `omarchy/.config/omarchy/plugins/<id>/` in this repo and stow to `~/.config/omarchy/plugins/<id>/`. Each plugin is a `manifest.json` plus an entry-point QML file.

To change the bar, edit the generator (then rebuild `dot`) or edit a plugin's QML, never the live `shell.json`.

:::caution[Omarchy's shell source is read-only]
The shell itself lives in `~/.local/share/omarchy/shell/`. Reading it is useful (the `BarWidget` / `WidgetButton` base classes live there), but edits are lost on `omarchy update`. Customisation belongs in plugins and the generated config.
:::

## Generated `shell.json`

`dot stow` regenerates `shell.json` for the active [host](/omarchy/host-overrides/), starting from Omarchy's default and adding personal modules around the stock ones ("add, not remove"). The generator owns widget sections and ordering so desktop and laptop stay aligned; rearranging widgets through Quattro is reset on the next stow. The merge is idempotent: it only rewrites the file when the rendered content changes.

Per-host differences:

- **Bar position**: `bottom` on `laptop`, `top` on every other host.
- **Clock position**: at the far right on `laptop`, centred on every other host.
- **Clock format**: compact `HH:mm d MMM`, based on the final pre-Quattro Waybar clock without its weekday or ordinal day suffix. The `timmo.clock` clone reduces the stock clock's 8.75px cell padding to 6px. Left-click opens the calendar, middle-click opens timezone settings, and right-click has no action.
- **Idle timers**: screensaver at 2.5 minutes and lock at 5 minutes on `laptop`; screensaver at 30 minutes and lock at 60 minutes on every other host.
- **Home Assistant sensors**: temperature, CO2, doorbell, and VOC entities differ per host (desktop vs laptop).

## Bar item order

The tables below show the rendered left-to-right order within each section. Omarchy pins `omarchy.tray` to the inner edge of the right section at runtime, regardless of where it appears in `shell.json`.

### Desktop

| Section | Order | Item | Change |
| --- | ---: | --- | --- |
| Left | 1 | Menu (`omarchy.menu`) | Retained in its stock position. |
| Left | 2 | Workspaces (`timmo.workspaces`) | Replaces `omarchy.workspaces` in place. |
| Left | 3 | Calendar | Added after workspaces, at the end of the section. |
| Centre | 1 | Indicators (`omarchy.indicators`) | Retained before the clock. |
| Centre | 2 | Clock (`timmo.clock`) | Replaces `omarchy.clock` in place and remains the centre anchor. |
| Centre | 3 | Keyboard layout (`omarchy.keyboard-layout`) | Retained after the clock. |
| Centre | 4 | Time check | Added after keyboard layout. |
| Centre | 5 | In-call state | Added after time check. |
| Centre | 6 | NAS activity | Added after in-call state. |
| Centre | 7 | GitHub notifications | Added after NAS activity. |
| Centre | 8 | Repository diff status | Added after GitHub notifications. |
| Centre | 9 | GitHub workflow status | Added after repository diff status. |
| Centre | 10 | Package updates | Added after GitHub workflow status. |
| Centre | 11 | Twitch notifications | Added after package updates. |
| Centre | 12 | System update (`omarchy.system-update`) | Retained after the added status items. |
| Centre | 13 | Doorbell trigger | Added at the end of the section and always visually hidden. |
| Right | 1 | Tray (`omarchy.tray`) | Retained and pinned to the inner edge by Omarchy. |
| Right | 2 | Outdoor temperature | Replaces `omarchy.weather` and sits immediately after the tray. |
| Right | 3 | Heating state | Added after outdoor temperature. |
| Right | 4 | CO₂ alert | Added after heating state. |
| Right | 5 | Rain state | Added after the CO₂ alert. |
| Right | 6 | Office temperature | Added after rain state. |
| Right | 7 | AI agents (`omarchy.agents`) | Retained after all Home Assistant items. |
| Right | 8 | Bluetooth (`omarchy.bluetooth`) | Retained immediately before network. |
| Right | 9 | Network (`omarchy.network`) | Retained immediately after Bluetooth. |
| Right | 10 | Audio (`omarchy.audio`) | Retained after network. |
| Right | 11 | Monitor (`omarchy.monitor`) | Retained after audio. |
| Right | 12 | Power (`omarchy.power`) | Retained at the end of the section. |

### Laptop

The left section matches desktop. The centre and right sections differ as follows:

| Section | Order | Item | Change |
| --- | ---: | --- | --- |
| Centre | 1 | Indicators (`omarchy.indicators`) | Retained at the start of the section. |
| Centre | 2 | Keyboard layout (`omarchy.keyboard-layout`) | Retained after indicators because the clock moves right. |
| Centre | 3 | Time check | Added after keyboard layout. |
| Centre | 4 | In-call state | Added after time check. |
| Centre | 5 | NAS activity | Added after in-call state. |
| Centre | 6 | GitHub notifications | Added after NAS activity. |
| Centre | 7 | Repository diff status | Added after GitHub notifications. |
| Centre | 8 | GitHub workflow status | Added after repository diff status. |
| Centre | 9 | Package updates | Added after GitHub workflow status. |
| Centre | 10 | Twitch notifications | Added after package updates. |
| Centre | 11 | System update (`omarchy.system-update`) | Retained after the added status items. |
| Centre | 12 | Doorbell trigger | Added at the end of the section and always visually hidden. |
| Right | 1 | Tray (`omarchy.tray`) | Retained and pinned to the inner edge by Omarchy. |
| Right | 2 | Outdoor temperature | Replaces `omarchy.weather` and sits immediately after the tray. |
| Right | 3 | Heating state | Added after outdoor temperature. |
| Right | 4 | VOC alert | Added on laptop only, after heating state. |
| Right | 5 | CO₂ alert | Added after the VOC alert. |
| Right | 6 | Rain state | Added after the CO₂ alert. |
| Right | 7 | Main temperature | Added after rain state. |
| Right | 8 | Dining-room temperature | Added on laptop only, after the main temperature. |
| Right | 9 | AI agents (`omarchy.agents`) | Retained after all Home Assistant items. |
| Right | 10 | Bluetooth (`omarchy.bluetooth`) | Retained immediately before network. |
| Right | 11 | Network (`omarchy.network`) | Retained immediately after Bluetooth. |
| Right | 12 | Audio (`omarchy.audio`) | Retained after network. |
| Right | 13 | Monitor (`omarchy.monitor`) | Retained after audio. |
| Right | 14 | Power (`omarchy.power`) | Retained after monitor. |
| Right | 15 | Clock (`timmo.clock`) | Moves from the centre to the end of the right section. |

The personal status widgets read from bar-agnostic scripts, `dot` JSON output, and Home Assistant. Command and streaming-command cells render at 10px; stock-sized custom icons, the clock, and workspaces render at 11px. Hidden numeric sensors show their current non-zero reading while the bar is hovered. Integer and decimal zero values are omitted while any accompanying icon remains; class-based visibility and hover reveals still follow each widget's existing rules, with zero-state icons faded from their active colour. See [Bar Integrations](/bar-integrations/) for the `--bar-json` commands behind the git and notification cells.

## Stock Quattro comparison

The generated config starts from Omarchy Quattro's shipped `shell.json` and modifies that layout rather than replacing it wholesale.

No stock widget is removed without a replacement. `omarchy.workspaces` is replaced in place by `timmo.workspaces`, which shows only workspaces that currently exist, displays the focused workspace number at full opacity, and dims the others. `omarchy.weather` is replaced by the outdoor-temperature item immediately after the tray; it stays hidden until the bar is hovered, then shows its icon and current value. Clicking it opens the Met Office weather entity in Home Assistant.

All custom additions use `revealOnHover`: status cells hidden in their normal inactive state appear dimmed while the bar is hovered. Entries whose inactive producer output is empty use `hiddenText` to retain an icon or zero count. Attention and active states remain visible according to each widget's class rules.

The stock alternate clock format, opaque bar, config version, and plugin list are also preserved. The normal clock format uses the compact pre-Quattro layout, while the `timmo.clock` centre anchor is used on desktop and cleared when the laptop moves the clock right.

### Host overrides

| Setting | Stock Quattro | Desktop | Laptop |
| --- | --- | --- | --- |
| Bar position | Top | Top | Bottom |
| Clock position | Centre | Centre | Right |
| Screensaver | 2.5 minutes | 30 minutes | 2.5 minutes |
| Lock | 5 minutes | 60 minutes | 5 minutes |

Home Assistant entity IDs and the doorbell popup monitor and size also vary by host. The laptop adds the VOC and dining-room temperature widgets listed above; the desktop omits them.

The session keeps its normal Qt scale for applications, while the `~/.config/hypr/bin/quickshell` wrapper resets `QT_SCALE_FACTOR` to `1` only for Omarchy shell launches. Wayland output scaling still handles the shell's HiDPI rendering, avoiding an additional Qt multiplier across the bar, notifications, and popup plugins.

## Custom plugins

A plugin is a folder with `manifest.json` (schema version 1, an `id` like `timmo.<name>`, its `kinds`, and entry-point QML) plus the QML itself. A bar widget extends `BarWidget`, reads per-instance settings from `shell.json` via `setting(name, fallback)`, and uses `WidgetButton` for clickable cells.

| Plugin | Kind | What it does |
| --- | --- | --- |
| `timmo.clock` | bar-widget | Keeps the stock clock and calendar behaviour with compact 6px cell padding. |
| `timmo.command` | bar-widget | Runs a shell command on an interval and renders its status-bar JSON (`text` / `tooltip` / `class`) with compact 6px horizontal cell margins. The Waybar `custom/*` equivalent. |
| `timmo.stream-command` | bar-widget | Runs a long-running command that streams status-bar JSON lines and renders the latest line with compact 6px horizontal cell margins (for watchers like `ha-watch-singleton`). |
| `timmo.workspaces` | bar-widget | Workspace numbers without persistent workspaces: only existing workspaces show, the focused one at full opacity and the rest dimmed. |

`timmo.command` and `timmo.stream-command` both support `classColors` (class-name to colour), `hideClasses`, `hiddenText`, `onClick` / `onClickRight`, and `revealOnHover`, so the generator can style and wire every cell without bespoke QML per module. Shell-launched web apps run through the reusable `launch-floating-webapp` command, which places only the new window at mobile size in the monitor's bottom-right corner. Normal launches of the same sites remain tiled. TUI click targets use the existing `TUI.float` app id.

:::note[New plugins need a stow]
`~/.config/omarchy/plugins/` is a real directory with per-plugin symlinks. A brand-new plugin needs `dot stow` to create its symlink before the shell sees it; editing an existing plugin's files is already live.
:::

## Reloading the shell

| Change | Action |
| --- | --- |
| `shell.json` layout or settings, existing modules only | Hot-reloads on save, nothing to run |
| New plugin added | `omarchy shell shell rescanPlugins`, then the hot-reload picks it up |
| User plugin QML edited | Hot-reloads on save, nothing to run |
| Omarchy's first-party shell QML edited, or hot-reload fails | `omarchy restart shell` (full restart) |

`dot update` bakes this in: it regenerates `shell.json` and reloads the running shell **only when the rendered config changed**. A standalone `dot stow` regenerates the file but does not reload.

:::caution[Force Wayland on restart]
`omarchy restart shell` inherits the caller's environment. If `QT_QPA_PLATFORM=xcb`, Quickshell starts under XWayland, the layer-shell surface cannot attach, and the bar renders as a floating window with no error. Interactive shells here set `QT_QPA_PLATFORM="wayland;xcb"`, and `dot update` forces `QT_QPA_PLATFORM=wayland` on its reload. From any non-interactive context (SSH, systemd, an agent shell), force Wayland explicitly:

```bash
QT_QPA_PLATFORM=wayland omarchy restart shell
```

:::
