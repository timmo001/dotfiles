---
title: Host Overrides
description: Managed Omarchy repos and stowed host configuration.
sidebar:
  order: 2
---

## Managed Omarchy repos

`dot` tracks a small set of Omarchy components as git repos and keeps them on the expected branch:

- `waybar` and `uwsm` — single-branch Omarchy repos expected on `main`.

`dot init` clones these into `~/.config/{waybar,uwsm}`. If a stock Omarchy config directory already exists there and is not a git repo, init moves it aside with a `.dot-init-backup-*` suffix before cloning. `dot update` syncs them, and `dot doctor` verifies their worktree branches.

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

Hyprland config is a stowed dotfiles package (`hypr/.config/hypr/`, conf-only), not a tracked repo. Host-specific overrides live under `~/.config/hypr/hosts/$OMARCHY_HOST`, selected by the runtime `~/.config/hypr/host` symlink.

- `dot stow` lays down the Hypr package with `--no-folding` and creates/repairs `~/.config/hypr/host` to point at the active host.
- `dot init` selects the Hypr host early (via `--host <name>`, defaulting to `OMARCHY_HOST` or `desktop`), and the stow phase creates the `host` symlink.
- `dot doctor` checks the host link and flags any leftover legacy `omarchy-hypr` clone at `~/.config/hypr`.
- Shared Hyprland-loaded config files wrap host override `source = ~/.config/hypr/host/*.conf` lines in Hyprland's `hyprlang noerror` guard, so a missing host override during stow, update, or migration does not leave Hyprland in an error loop.

Shared Hypr autostart lives in `~/.config/hypr/autostart.conf` and runs on every host before the selected host override is sourced. Host-only services stay in `~/.config/hypr/host/autostart.conf`. KDE Connect starts on both hosts, while the OpenCode server starts only on the desktop.

:::caution[Retired omarchy-hypr clone]
A machine with the retired `~/.config/hypr` `omarchy-hypr` clone halts `dot update` until the clone is backed up and re-stowed. Hyprland config is a stowed package, not a cloned repo.
:::

## Environment

- `OMARCHY_HOST` — the Hypr host override name (e.g. `desktop`, `laptop`).
- `OMARCHY_REPO_BASE_DIR` — Omarchy repo base path (default `~/.config`).
- `DOT_OMARCHY_BRANCH` — branch override during sync.

See [Environment Variables](/configuration/environment/) for the full list.
