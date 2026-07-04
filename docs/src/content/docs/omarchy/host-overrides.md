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

:::caution[Retired omarchy-hypr clone]
A machine still on the retired `~/.config/hypr` `omarchy-hypr` clone halts `dot update` until the clone is backed up and re-stowed. Hyprland is now a stowed package, not a cloned repo.
:::

## Environment

- `OMARCHY_HOST` — the Hypr host override name (e.g. `desktop`, `laptop`).
- `OMARCHY_REPO_BASE_DIR` — Omarchy repo base path (default `~/.config`).
- `DOT_OMARCHY_BRANCH` / `DOT_BOOTSTRAP_BRANCH` — branch overrides during sync.

See [Environment Variables](/configuration/environment/) for the full list.
