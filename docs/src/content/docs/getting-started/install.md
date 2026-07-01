---
title: Install
description: Prerequisites, bootstrap build, and the ongoing dotfiles workflow.
---

## Prerequisites

On a fresh [Omarchy](https://omarchy.org) machine, install the bootstrap build prerequisites ([git](https://git-scm.com) and [mise](https://mise.jdx.dev)):

```bash
yay -S --needed git mise-bin
```

If you want the private dotfiles overlay, authenticate [`gh`](https://cli.github.com) (the GitHub CLI) before `dot init` so it can clone `dotfiles-private` automatically:

```bash
gh auth status || gh auth login
```

## Clone and build

Clone the public dotfiles first, then build the `dot` binary before it is on your `PATH`:

```bash
git clone git@github.com:timmo001/dotfiles.git ~/.config/dotfiles

cd ~/.config/dotfiles/dot
mise --no-config exec bun@latest -- bun install
mise --no-config exec bun@latest -- bun run build
```

## First-use setup

`dot init` runs the one-time first-use setup: it bootstraps private dotfiles when `gh auth` is available, syncs Omarchy repos, selects the Hypr host, installs and adopts config, installs stowed mise tools, sets up packages and machine hooks, syncs agents, and finishes with `dot update`. It logs to `~/.local/state/dot/init.log` by default.

```bash
~/.config/dotfiles/scripts/.local/bin/dot init --noninteractive --confirm
```

For a laptop, select the laptop host:

```bash
dot init --host laptop --noninteractive --confirm
```

Or run `dot init` in an interactive shell to be prompted.

:::note
If stock Omarchy directories already exist at `~/.config/waybar`, `~/.config/ghostty`, or `~/.config/uwsm`, `dot init` backs them up with a `.dot-init-backup-*` suffix before cloning the managed repos. Hyprland config is stowed from the `hypr/` package instead.
:::

## Ongoing workflow

After restarting your shell so `dot` is on `PATH`:

```bash
dot update    # self-update, install deps, rebuild, pull, stow, restart
dot git-diff  # review changes across managed repos
dot doctor    # health checks
```

`dot update` is the everyday command: it self-updates the public dotfiles, installs dependencies, rebuilds and restarts on the new binary, then runs Omarchy and public/private pulls, a stow refresh, and Hypr host-link setup. See the [Command Reference](/dot/commands/) for the full flag list.
