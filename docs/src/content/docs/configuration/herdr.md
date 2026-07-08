---
title: Herdr Config
description: Shared Herdr configuration and integrations.
sidebar:
  order: 3
---

Herdr config is stowed to `~/.config/herdr/config.toml`. It keeps the shared prefix, theme, layout threshold, and OpenCode toast delivery reproducible.

Ghostty and zsh do not auto-start Herdr. Start it explicitly with `herdr` when you want a Herdr-managed terminal session.

## Keyboard

Herdr uses `Ctrl+Space` as its prefix. Press `Ctrl+Space`, then a Herdr key. Caps Lock remains the Hyprland/XKB compose key in `~/.config/hypr/input.conf`.

`prefix+d` opens the `dot` TUI from inside Herdr.

`prefix+b` toggles the sidebar manually. The managed config raises `mobile_width_threshold` to 90 columns so narrow terminals switch to Herdr's compact single-column layout earlier.

## Integrations

`dot init` and full `dot update` runs install managed Herdr integrations such as OpenCode automatically. It skips cleanly when `herdr` is not installed yet.

Run a manual repair after changing Herdr config:

```bash
dot stow
dot herdr-sync
```
