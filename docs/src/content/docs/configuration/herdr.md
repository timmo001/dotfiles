---
title: Herdr Session
description: Default terminal session, Ctrl+Space prefix, and dot actions.
sidebar:
  order: 3
---

Herdr is the managed terminal session layer for local Ghostty shells. New local interactive Ghostty zsh sessions attach to the default Herdr session when `herdr` is available. The Herdr client replaces the startup shell, so exiting Herdr also closes that Ghostty terminal instead of dropping to a spare zsh prompt.

Plain zsh panes keep normal `Ctrl+D` behaviour. When a Herdr-managed zsh pane exits and it is the only pane in the only tab in the only workspace, zsh stops the Herdr server so Ghostty can close instead of Herdr opening a fresh empty workspace.

Set `DOT_NO_HERDR=1` to skip the auto-attach for one recovery shell:

```bash
DOT_NO_HERDR=1 zsh
```

## Keyboard

Herdr uses `Ctrl+Space` as its prefix. Press `Ctrl+Space`, then a Herdr key. Caps Lock remains the Hyprland/XKB compose key in `~/.config/hypr/input.conf`.

The custom action layer is on `prefix+d`. It opens the dot actions palette:

- `/` searches the curated actions.
- `:` runs a raw command from the palette shell.
- Repo-specific actions use the focused pane cwd when it is a git repo.
- When a pane is not in a git repo, repo actions prompt from the tracked repos in `dot git-diff --list-all`.

The old OpenCode-only lazygit and `dot git-diff` TUI keybindings are removed; Herdr owns those actions from any pane.

## Plugin

The stowed plugin lives at `~/.config/herdr/plugins/dot-actions` and is linked by:

```bash
dot herdr-sync
```

`dot init` and `dot update` run `dot herdr-sync` automatically. It skips cleanly when `herdr` is not installed yet.

The action manifest is stowed to `~/.config/herdr/actions.json`. It includes lazygit, dot Git views, notes, handoffs, context snapshots, and confirm-gated maintenance actions such as `dot update`, `dot stow`, `dot doctor`, `dot agents-sync`, `dot mcp-sync`, `dot skill-check`, `dot skill-updates`, `dot firewall`, and `system-health-check`.

## Maintenance

Mutating maintenance actions ask for confirmation before running. The confirmation shows the command and requires typing `run`.

Run a manual repair after changing Herdr config or plugin files:

```bash
dot stow
dot herdr-sync
```
