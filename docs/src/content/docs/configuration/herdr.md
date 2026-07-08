---
title: Herdr Session
description: Default terminal session and Ctrl+Space prefix.
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

`prefix+d` and `SUPER+ALT+D` open the `dot` TUI. When the focused window is Ghostty, `dot-launch-tui` opens `dot` in a new Herdr tab using the focused pane cwd. From other windows it opens a floating TUI terminal.

## Integrations

`dot init` and full `dot update` runs install managed Herdr integrations such as OpenCode automatically. It skips cleanly when `herdr` is not installed yet.

Run a manual repair after changing Herdr config:

```bash
dot stow
dot herdr-sync
```
