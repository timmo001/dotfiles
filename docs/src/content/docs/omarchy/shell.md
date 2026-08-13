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
- **Clock position**: at the far right on every host.
- **Clock format**: compact `HH:mm d MMM`, based on the final pre-Quattro Waybar clock without its weekday or ordinal day suffix. The `timmo.clock` clone reduces the stock clock's 8.75px cell padding to 6px. Left-click opens the calendar, middle-click opens timezone settings, and right-click has no action.
- **Idle timers**: screensaver at 2.5 minutes and lock at 5 minutes on `laptop`; screensaver at 30 minutes and lock at 60 minutes on every other host.
- **Home Assistant dashboard**: desktop uses the office temperature and CO₂ sensors; laptop uses the living-room sensors and adds VOC and dining-room temperature rows.
- **Primary output**: personal status widgets render only on `HDMI-A-2` on desktop and `eDP-1` on laptop. If that output is unavailable, Quickshell's first screen is used.

## Bar item order

The tables below show the rendered left-to-right order within each section. Omarchy pins `omarchy.tray` to the inner edge of the right section at runtime, regardless of where it appears in `shell.json`.

### Desktop

| Section | Order | Item | Change |
| --- | ---: | --- | --- |
| Left | 1 | Menu (`omarchy.menu`) | Retained in its stock position. |
| Left | 2 | Workspaces (`timmo.workspaces`) | Replaces `omarchy.workspaces` in place. |
| Centre | 1 | Indicators (`omarchy.indicators`) | Retained at the start of the section. |
| Centre | 2 | Keyboard layout (`omarchy.keyboard-layout`) | Retained after indicators because the clock moves right. |
| Centre | 3 | Twitch notifications | Added after the built-in centre widgets. |
| Centre | 4 | Git (`timmo.git`) | Combines repository state and GitHub notifications in one native panel. |
| Centre | 5 | Package updates | Added after Git. |
| Centre | 6 | System update (`omarchy.system-update`) | Retained after the added status items. |
| Right | 1 | Tray (`omarchy.tray`) | Retained and pinned to the inner edge by Omarchy. |
| Right | 2 | Home Assistant (`timmo.home-assistant`) | Shows active HA status icons and values in one widget and opens the native dashboard panel. |
| Right | 3 | Bluetooth (`omarchy.bluetooth`) | Retained immediately before network. |
| Right | 4 | Network (`omarchy.network`) | Retained immediately after Bluetooth. |
| Right | 5 | Audio (`omarchy.audio`) | Retained after network. |
| Right | 6 | Monitor (`omarchy.monitor`) | Retained after audio. |
| Right | 7 | Power (`omarchy.power`) | Retained at the end of the section. |
| Right | 8 | Clock (`timmo.clock`) | Moves from the centre to the end of the right section. |

### Laptop

The bar order matches desktop. Inside the Home Assistant panel, laptop uses its living-room temperature and CO₂ entities and adds VOC and dining-room temperature rows.

The full item order above appears only on the primary output. Secondary outputs keep the core menu, `timmo.workspaces`, `timmo.clock`, and built-in system widgets; Twitch, Git, command cells, and the Home Assistant widget collapse without starting per-output pollers or loading their panels.

The personal status widgets read from bar-agnostic scripts, `dot` JSON output, and Home Assistant. Command cells and the Home Assistant aggregate render at 10px; stock-sized custom icons, the clock, and workspaces render at 11px. See [Bar Integrations](/bar-integrations/) for the JSON commands behind the bar and dashboard.

## Stock Quattro comparison

The generated config starts from Omarchy Quattro's shipped `shell.json` and modifies that layout rather than replacing it wholesale.

`omarchy.workspaces` is replaced in place by `timmo.workspaces`, which shows only workspaces that currently exist, displays the focused workspace number at full opacity, and dims the others. `omarchy.weather` is replaced by the Home Assistant dashboard immediately after the tray; its outdoor row opens the same Met Office weather entity and hourly forecast. The stock `omarchy.agents` widget is intentionally removed without replacement.

The Home Assistant plugin uses one bar widget whose width follows its visible content. It shows each currently visible row's original compact icon and value, with its configured colour, in left-to-right order, or the Home Assistant icon when every row is quiet. Conditional rows appear only while active, warning, or critical; regular readings remain visible whenever their source output is available, except outdoor temperature, which appears only above 25 °C. Hovering does not reveal extra states. Clicking the widget opens the complete dashboard panel, including quiet and unavailable rows. Activating a row that opens a link closes the panel first. The Clock, Home Assistant, and Twitch panels align with their corresponding bar widgets rather than the centre of the screen.

The stock alternate clock format, opaque bar, config version, and plugin list are also preserved. The normal clock format uses the compact pre-Quattro layout, while the centre anchor is cleared when `timmo.clock` moves right.

### Host overrides

| Setting | Stock Quattro | Desktop | Laptop |
| --- | --- | --- | --- |
| Bar position | Top | Top | Bottom |
| Clock position | Centre | Right | Right |
| Primary output | First screen | `HDMI-A-2` | `eDP-1` |
| Screensaver | 2.5 minutes | 30 minutes | 2.5 minutes |
| Lock | 5 minutes | 60 minutes | 5 minutes |

Home Assistant entity IDs vary by host. The laptop adds the VOC and dining-room temperature rows; the desktop omits them. The background doorbell watcher uses the active workspace on both hosts.

The session keeps its normal Qt scale for applications, while the `~/.config/hypr/bin/quickshell` wrapper resets `QT_SCALE_FACTOR` to `1` only for Omarchy shell launches. Wayland output scaling still handles the shell's HiDPI rendering, avoiding an additional Qt multiplier across the bar, notifications, and popup plugins.

## Custom plugins

A plugin is a folder with `manifest.json` (schema version 1, an `id` like `timmo.<name>`, its `kinds`, and entry-point QML) plus the QML itself. A bar widget extends `BarWidget`, reads per-instance settings from `shell.json` via `setting(name, fallback)`, and uses `WidgetButton` for clickable cells.

| Plugin | Kind | What it does |
| --- | --- | --- |
| `timmo.clock` | bar-widget | Keeps the stock clock and calendar behaviour with compact 6px cell padding. |
| `timmo.command` | bar-widget | Runs a shell command on an interval and renders its status-bar JSON (`text` / `tooltip` / `class`) with compact 6px horizontal cell margins. The Waybar `custom/*` equivalent. |
| `timmo.home-assistant` | service, bar-widget | Summarises active HA schedule, status, NAS, and environment rows in one widget and adds a native dashboard panel while keeping the doorbell watcher alive in the background. |
| `timmo.git` | service, bar-widget | Combines repository state and filtered GitHub notifications in one widget and native panel. |
| `timmo.stream-command` | bar-widget | Runs a long-running command that streams status-bar JSON lines and renders the latest line with compact 6px horizontal cell margins (for watchers like `ha-watch-singleton`). |
| `timmo.twitch` | service, bar-widget | Shows live Twitch state and opens an attached panel for channels and notification controls. |
| `timmo.workspaces` | bar-widget | Workspace numbers without persistent workspaces: only existing workspaces show, the focused one at full opacity and the rest dimmed. |

`timmo.command` and `timmo.stream-command` both support `classColors` (class-name to colour), `hideClasses`, `hiddenText`, `onClick` / `onClickRight`, and `revealOnHover`, so the generator can style and wire every cell without bespoke QML per module. Shell-launched web apps run through the reusable `launch-floating-webapp` command, which places only the new window at mobile size in the monitor's bottom-right corner. Normal launches of the same sites remain tiled. TUI click targets use the existing `TUI.float` app id.

`timmo.twitch` keeps one polling service for the whole shell and shares it across bar instances. Left click opens its channel panel, middle click rechecks notifications, and right click restarts the notifier. The active state stays hidden until the bar is hovered; live and unavailable states remain visible.

`timmo.git` polls `dot git-diff --bar-json` and `dot git-notifications --bar-json` once per minute through one shell service. Each source appears only while its count is above zero, so a clean source contributes neither an icon nor a count. Important notifications are red, ordinary changes or unread notifications amber, pull-only repositories green, private-only dirt blue, and unavailable state grey. When both sources are clear, the widget collapses and reveals both bare icons dimmed while hovering the bar or while its panel is open. Left click opens an anchored panel with actions, changed repository rows, and notification rows; right click refreshes both sources. Activating a changed repository opens `dot git-diff` directly in lazygit for that repository; quitting lazygit resumes the selected diff TUI. Other actions open the full Changed TUI, Other TUI, filtered notifications TUI, or a notification URL.

`timmo.home-assistant` keeps the HA pollers and singleton streams in one shell service. `Config.qml` owns the desktop and laptop entity mappings, commands, actions, aggregate show conditions, labels, icons, colours, and panel sizing; the other QML files only run and render that configuration. Its panel preserves the previous left-to-right HA order: Calendar under Schedule, Time Check, In a Call, and NAS under Status, then the former right-side weather, heating, air-quality, rain, and temperature rows under Environment. Every row remains visible in the panel. Clicking Calendar or a sensor opens its existing floating full view; Time Check and In a Call retain their direct toggle actions. The doorbell stream stays loaded without a visible row and continues opening the camera popup on an active transition.

:::note[New plugins need a stow]
`~/.config/omarchy/plugins/` is a real directory with per-plugin symlinks. A brand-new plugin needs `dot stow` to create its symlink before the shell sees it; editing an existing plugin's files is already live.
:::

## Reloading the shell

| Change | Action |
| --- | --- |
| `shell.json` layout or settings, existing modules only | Hot-reloads on save, nothing to run |
| New plugin added | `omarchy-shell shell rescanPlugins`, then the hot-reload picks it up |
| User plugin QML edited | Hot-reloads on save, nothing to run |
| Omarchy's first-party shell QML edited, or hot-reload fails | `omarchy restart shell` (full restart) |

`dot update` bakes this in: it regenerates `shell.json` and reloads the running shell **only when the rendered config changed**. A standalone `dot stow` regenerates the file but does not reload.

:::caution[Force Wayland on restart]
`omarchy restart shell` inherits the caller's environment. If `QT_QPA_PLATFORM=xcb`, Quickshell starts under XWayland, the layer-shell surface cannot attach, and the bar renders as a floating window with no error. Interactive shells here set `QT_QPA_PLATFORM="wayland;xcb"`, and `dot update` forces `QT_QPA_PLATFORM=wayland` on its reload. From any non-interactive context (SSH, systemd, an agent shell), force Wayland explicitly:

```bash
QT_QPA_PLATFORM=wayland omarchy restart shell
```

:::
