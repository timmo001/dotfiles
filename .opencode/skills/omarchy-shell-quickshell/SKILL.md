---
name: omarchy-shell-quickshell
description: Customise and reload the Omarchy shell (omarchy-shell) - the Quickshell process behind the bar, notifications, OSD, launcher, and settings - in this dotfiles repo. Use when working with the Omarchy shell or Quickshell: editing omarchy/.config/omarchy/plugins/, the shell.json generator dot/src/lib/omarchyShellConfig.ts, shell.json, BarWidget/WidgetButton or other Quickshell QML, running omarchy plugin or omarchy restart shell, referencing upstream Quickshell, or when a shell or bar change is not showing up.
---

# Omarchy Shell (Quickshell)

## Background / upstream

- The Omarchy shell is a single long-running **Quickshell** process (`omarchy-shell`) that hosts the top bar, notification daemon, on-screen display, launcher, and settings panel. Restarting "the shell" restarts all of them together.
- **Quickshell** is the upstream framework: a QML/Qt6 toolkit for Wayland desktop shells (layer-shell surfaces via `WlrLayershell`, an IPC bus, and live QML reload). Upstream is self-hosted Forgejo at `git.outfoxxed.me/quickshell/quickshell`; the opencode `quickshell` reference clones the official GitHub mirror `quickshell-mirror/quickshell`. Use it for QML types, layer-shell, `IpcHandler`, reloadable config, and the `qs` CLI.
- Omarchy's shell source lives in `~/.local/share/omarchy/shell/` - **READ-ONLY** (reading is useful: base classes `BarWidget`/`WidgetButton` in `shell/Ui/`, the bar host in `shell/plugins/bar/Bar.qml`). Edits are lost on `omarchy update`.

## Source of truth (never edit live)

- Custom shell content ships as **user plugins**. Edit the stow source `omarchy/.config/omarchy/plugins/<id>/` (stows to `~/.config/omarchy/plugins/<id>/`).
- `~/.config/omarchy/shell.json` is **generated, not hand-edited**. It is rendered by `dot` from `dot/src/lib/omarchyShellConfig.ts` (`mergeOmarchyShellConfig`), starting from Omarchy's default and inserting personal modules. Edit the generator, rebuild `dot`, then `dot stow` regenerates the file. The live file is mode `0600` and tracked by neither dotfiles repo.

## Plugin layout

A plugin is a folder with `manifest.json` + entry-point QML:

- `manifest.json`: `schemaVersion: 1`, `id: "timmo.<name>"`, `kinds` (e.g. `["bar-widget"]`), `entryPoints` mapping each kind to a QML file, and a per-kind config block (for a bar widget: `barWidget` with `displayName`, `category`, `allowMultiple`).
- Entry QML: a bar widget extends `BarWidget` (`import qs.Commons`, `import qs.Ui`), sets `moduleName` to the plugin id, reads per-instance `shell.json` settings via `setting(name, fallback)`, and uses `WidgetButton` for clickable text cells.

Stow gotcha: `~/.config/omarchy/plugins/` is a **real directory with per-plugin symlinks**. A brand-new plugin needs `dot stow` to create its symlink before the shell sees it. Editing an existing plugin's files is already live (symlink -> dotfiles source).

## Reload matrix (run after a change)

| Change | Action |
| --- | --- |
| `shell.json` layout/settings, existing modules only | Hot-reloads on save - nothing to run |
| New plugin added | `omarchy plugin rescan`, then the hot-reload picks it up |
| Plugin / shell QML code edited | `omarchy restart shell` (full restart) |

`omarchy restart shell` (= `omarchy-restart-shell`: `pkill -x quickshell` + detached `setsid` relaunch) is the **only** reliable way to load new or changed QML. `omarchy plugin rescan` and `omarchy-shell shell reloadConfig` do **not** reload cached QML.

## The XCB trap (critical)

`omarchy-restart-shell` inherits the caller's environment. If `QT_QPA_PLATFORM=xcb`, Quickshell starts under XWayland, `WlrLayershell` cannot attach, and the shell renders as a **floating window** instead of bar/overlay surfaces (no error).

- Interactive shells in this repo set `QT_QPA_PLATFORM="wayland;xcb"` (`zsh/.zshrc`) so a direct `omarchy restart shell` works. A plain `xcb` reintroduces the floating-window bug.
- From any non-interactive context (SSH, `systemd`, `cron`, an agent shell) force Wayland and make sure the session is reachable:

```bash
QT_QPA_PLATFORM=wayland omarchy restart shell   # needs WAYLAND_DISPLAY + XDG_RUNTIME_DIR
```

- `dot update` bakes this in: it reloads the shell **only when the generated `shell.json` changed**, forcing `QT_QPA_PLATFORM=wayland` on the restart (`reloadOmarchyShell` in `dot/src/commands/Update.ts`). Standalone `dot stow` does not reload.

## Lint (required after every final QML change)

After every final QML edit, lint the files you touched with the **Qt6** `qmllint`. On Arch the Qt6 binary is `/usr/lib/qt6/bin/qmllint` - the bare `/usr/bin/qmllint` may be an older Qt5 build that rejects these flags. `-I /usr/lib/qt6/qml` lets it resolve the installed `Quickshell.*` modules:

```bash
/usr/lib/qt6/bin/qmllint -I /usr/lib/qt6/qml --import disable --unqualified disable <file>.qml
```

The shell's own `qs.*` modules ship in the (unpackaged) shell source, so the `import`/`unqualified` categories stay disabled as noise; `qmllint` still fails (non-zero) on real syntax errors, which is what the gate catches. This mirrors `.github/workflows/quickshell-lint.yml`, which lints inside an Arch container against the `quickshell` package pinned by `QUICKSHELL_VERSION` (kept in sync with the Arch package by Renovate via repology, and asserted to match). Lint must pass locally before a QML change is considered done.

## Verify

- `omarchy plugin list` - is the plugin registered and enabled?
- `omarchy-shell shell debugBarGeometry` - per-module `x`/`width`/`visible`; confirm a widget renders or collapses.
- `omarchy plugin validate <folder>` rejects symlinked plugin folders - **expected** for stowed plugins, not a real error.
- `grim -g "0,0 360x32" out.png` - visual check of the bar's left edge; after a restart confirm `hyprctl layers | grep omarchy-bar`.
- After editing the generator: `cd dot && bunx tsc --noEmit && bun run format && bun run build`.
