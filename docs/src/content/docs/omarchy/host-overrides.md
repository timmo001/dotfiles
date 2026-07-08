---
title: Host Overrides
description: Managed Omarchy repos and per-host Hyprland configuration.
sidebar:
  order: 2
---

## Managed Omarchy repos

`dot` tracks a small set of Omarchy components as git repos and keeps them on the expected branch:

- `waybar`, `ghostty`, and `uwsm` — single-branch Omarchy repos expected on `main`.
- `bootstrap` — expected on `distro/omarchy`.

`dot init` clones these into `~/.config/{waybar,ghostty,uwsm}`. If a stock Omarchy config directory already exists there and is not a git repo, init moves it aside with a `.dot-init-backup-*` suffix before cloning. `dot update` syncs them, and `dot doctor` verifies their worktree branches.

## Hyprland host overrides

Hyprland config is a stowed dotfiles package (`hypr/.config/hypr/`, conf-only), not a tracked repo. Host-specific overrides live under `~/.config/hypr/hosts/$OMARCHY_HOST`, selected by the runtime `~/.config/hypr/host` symlink.

- `dot stow` lays down the Hypr package with `--no-folding` and creates/repairs `~/.config/hypr/host` to point at the active host.
- `dot init` selects the Hypr host early (via `--host <name>`, defaulting to `OMARCHY_HOST` or `desktop`), and the stow phase creates the `host` symlink.
- `dot doctor` checks the host link and flags any leftover legacy `omarchy-hypr` clone at `~/.config/hypr`.
- Host override `source = ~/.config/hypr/host/*.conf` lines are wrapped in Hyprland's `hyprlang noerror` guard so a missing host override during stow, update, or migration does not leave Hyprland in an error loop.

Shared Hypr autostart lives in `~/.config/hypr/autostart.conf` and runs on every host before the selected host override is sourced. Host-only services stay in `~/.config/hypr/host/autostart.conf`. KDE Connect is shared, so `kdeconnect-indicator` starts on both desktop and laptop sessions.

:::caution[Retired omarchy-hypr clone]
A machine with the retired `~/.config/hypr` `omarchy-hypr` clone halts `dot update` until the clone is backed up and re-stowed. Hyprland config is a stowed package, not a cloned repo.
:::

## Environment

- `OMARCHY_HOST` — the Hypr host override name (e.g. `desktop`, `laptop`).
- `OMARCHY_REPO_BASE_DIR` — Omarchy repo base path (default `~/.config`).
- `DOT_OMARCHY_BRANCH` / `DOT_BOOTSTRAP_BRANCH` — branch overrides during sync.

See [Environment Variables](/configuration/environment/) for the full list.
