---
title: Host Overrides
description: Stowed Omarchy configuration and host overrides.
sidebar:
  order: 2
---

## UWSM environment

Quattro provides `/usr/share/uwsm/env.d/10-omarchy` and `/usr/share/omarchy/default/uwsm/default`, including the user-local binary path and mise activation. The stowed `~/.config/uwsm/env.d/90-dotfiles` adds only the custom Hypr helper path and OpenCode feature flags, without copying the generated `99-omarchy-upgrade-env` or timestamped upgrade backups. Omarchy keeps `BROWSER` shell-scoped so browser default selection continues to work.

## Ghostty host overrides

Ghostty config is a stowed dotfiles package (`ghostty/.config/ghostty/`), not a tracked Omarchy repo. The stowed `ghostty-host-config` launcher checks `OMARCHY_HOST` and loads `~/.config/ghostty/config.$OMARCHY_HOST` when present, falling back to the default `~/.config/ghostty/config` otherwise.

The shared config uses 8px window padding. The laptop override keeps that padding and reduces the font size from 10 to 9.

| Binding | Action |
| --- | --- |
| `CTRL+ALT+G` | Type and run `lazygit` |
| `CTRL+ALT+SHIFT+G` | Type and run `dot git-diff` |
| `CTRL+ALT+TAB` | Send tmux's next-window sequence |
| `CTRL+ALT+SHIFT+TAB` | Send tmux's previous-window sequence |

`dot install`, `dot init`, and `dot stow` back up the retired `timmo001/omarchy-ghostty` clone at `~/.config/ghostty` before linking the stowed config.

## Hyprland host overrides

Hyprland config is a stowed dotfiles package (`hypr/.config/hypr/`), not a tracked repo. Host-specific Lua overrides live under `~/.config/hypr/hosts/$OMARCHY_HOST`, selected by the runtime `~/.config/hypr/host` symlink.

- `dot stow` lays down the Hypr package with `--no-folding` and creates/repairs `~/.config/hypr/host` to point at the active host.
- `dot init` selects the Hypr host early (via `--host <name>`, defaulting to `OMARCHY_HOST` or `desktop`), and the stow phase creates the `host` symlink.
- `dot doctor` checks the host link and flags any leftover legacy `omarchy-hypr` clone at `~/.config/hypr`.
- Both host monitor overrides detect common virtual machines through DMI data and use unscaled toolkit and fallback monitor settings; bare-metal hosts keep their normal HiDPI scale.

Shared Hypr autostart lives in `~/.config/hypr/autostart.lua` and runs on every host before the selected host override is loaded. Host-only services stay in `~/.config/hypr/host/autostart.lua`. KDE Connect starts on both hosts, while the OpenCode server starts only on the desktop.

:::caution[Retired omarchy-hypr clone]
A machine with the retired `~/.config/hypr` `omarchy-hypr` clone halts `dot update` until the clone is backed up and re-stowed. Hyprland config is a stowed package, not a cloned repo.
:::

## Environment

- `OMARCHY_HOST` — the Hypr host override name (e.g. `desktop`, `laptop`).
- `OMARCHY_REPO_BASE_DIR` — Omarchy repo base path (default `~/.config`).

See [Environment Variables](/configuration/environment/) for the full list.
