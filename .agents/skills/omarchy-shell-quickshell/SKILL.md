---
name: omarchy-shell-quickshell
description: "Customise and reload the Omarchy shell (omarchy-shell) - the Quickshell process behind the bar, notifications, OSD, launcher, and settings - in this dotfiles repo. Use when working with the Omarchy shell or Quickshell: editing omarchy/.config/omarchy/plugins/, the shell.json generator dot/src/lib/omarchyShellConfig.ts, shell.json, BarWidget/WidgetButton or other Quickshell QML, running omarchy plugin or omarchy restart shell, referencing upstream Quickshell, or when a shell or bar change is not showing up."
---

# Omarchy Shell (Quickshell)

## Upstream contract

- The Omarchy shell is one long-running Quickshell process that hosts the bar, panels, overlays, menus, notifications, lock surface, and shell services as plugins.
- This work targets the `quattro` branch of `basecamp/omarchy`. Use the advertised `omarchy` reference for current source and compare its revision with `origin/quattro` when recency matters.
- `$OMARCHY_PATH` owns the installed Omarchy source, normally `/usr/share/omarchy`. Treat it as read-only because package updates replace it.
- Use the advertised `quickshell` reference for backend implementation details and compare its revision with upstream `master` when recency matters. The installed runtime version and revision are reported by `qs --version`.

Read the owning sources before relying on remembered plugin or backend behaviour:

- `$OMARCHY_PATH/docs/omarchy-shell.md` and `$OMARCHY_PATH/shell/README.md` for the shell and plugin contracts.
- `$OMARCHY_PATH/default/agents/skills/omarchy/plugins.md` for current end-user operations.
- `$OMARCHY_PATH/shell/services/PluginRegistry.qml` for manifest validation and discovery behaviour.
- `$OMARCHY_PATH/shell/plugins/` for maintained manifest and QML patterns. Use built-ins as locations to inspect, not templates to copy verbatim.
- `$OMARCHY_PATH/bin/omarchy-launch-shell`, `$OMARCHY_PATH/bin/omarchy-restart-shell`, and `$OMARCHY_PATH/bin/omarchy-shell` for lifecycle and IPC behaviour.
- The `quickshell` reference source for `WlrLayershell`, `IpcHandler`, reload semantics, and CLI behaviour.

## Source of truth (never edit live)

- Custom shell content ships as **user plugins**. Edit the stow source `omarchy/.config/omarchy/plugins/<id>/` (stows to `~/.config/omarchy/plugins/<id>/`).
- `~/.config/omarchy/shell.json` is **generated, not hand-edited**. It is rendered by `dot` from `dot/src/lib/omarchyShellConfig.ts` (`mergeOmarchyShellConfig`), starting from Omarchy's default and inserting personal modules. Edit the generator, rebuild `dot`, then `dot stow` regenerates the file. The live file is mode `0600` and tracked by neither dotfiles repo.

## Plugin workflow

- Confirm the current manifest contract in `PluginRegistry.qml` and inspect the nearest built-in under `$OMARCHY_PATH/shell/plugins/` before creating or changing a plugin.
- Keep third-party ids namespaced outside the reserved `omarchy.*` namespace.
- Prefer Omarchy's `omarchy plugin` and `omarchy bar` commands when they cover the operation. They own validation, enabled state, placement, and persisted layout.
- For a new manually installed plugin, run `dot stow`, rescan plugins, then enable the plugin. Rescanning discovers code but does not enable it.
- Existing user-plugin file changes are watched and reloaded automatically. Force a rescan only when discovery or automatic reload has not applied the change.
- Plugins run unsandboxed in the shell process. Review all plugin code before enabling it.

`~/.config/omarchy/plugins/` is a real directory with per-plugin symlinks. A new stowed plugin is invisible until `dot stow` creates its symlink. Existing plugin files are already live through their symlinks.

## Reload matrix (run after a change)

| Change | Action |
| --- | --- |
| `shell.json` layout/settings, existing modules only | Hot-reloads on save - nothing to run |
| User plugin QML edited | Hot-reloads on save - nothing to run |
| New manual plugin added | `dot stow`, rescan, then enable |
| Rescan or automatic reload cannot recover | Restart the shell with Omarchy's lifecycle command |

Use `$OMARCHY_PATH/docs/omarchy-shell.md` for current IPC method names and return values. A full `omarchy restart shell` protects an active lock session, stops matching Quickshell instances, and asks Hyprland to launch the replacement with the canonical session environment.

## Shell lifecycle

- Do not recreate shell launch or termination logic. Use `omarchy restart shell` and inspect the current launch scripts when diagnosing lifecycle behaviour.
- Current Quattro launches the replacement through Hyprland so it inherits the session environment rather than transient terminal, SSH, or agent variables. Do not add caller-side `QT_QPA_PLATFORM` workarounds based on older behaviour.
- Omarchy disables Quickshell's whole-config file watcher for the packaged shell and restarts deliberately during lifecycle operations. Shell-owned `FileView` and plugin-directory watchers still handle `shell.json` and user-plugin updates.
- `dot update` restarts the shell only when the generated `shell.json` changed. Standalone `dot stow` does not restart it.

## Lint (required after every final QML change)

After every final QML edit, lint the touched files with the Qt 6 `qmllint`. Use `.github/workflows/quickshell-lint.yml` as the source of truth for the binary, import path, warning policy, and CI backend version. The workflow deliberately performs a syntax-focused check because Omarchy's private `qs.*` modules are not packaged with the stable Quickshell syntax proxy. Lint must exit successfully before a QML change is done.

## Verify

- Use the current `omarchy plugin` command help to confirm registration, enabled state, and validation behaviour. Validation rejects symlinked plugin folders, which is expected for stowed plugins.
- Inspect `$OMARCHY_PATH/docs/omarchy-shell.md` and `$OMARCHY_PATH/shell/shell.qml` for available shell IPC diagnostics before invoking them.
- Use compositor layer inspection and a targeted screenshot when visual geometry matters; confirm that the bar remains a layer-shell surface after any full restart.
- After editing the generator: `mise run dot:check`.
