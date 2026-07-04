---
title: New Machine Checklist
description: Step-by-step setup for a new Omarchy machine.
---

A clean, end-to-end walkthrough for setting up a new machine.

1. Clone `dotfiles` to `~/.config/dotfiles`.
2. If you want private dotfiles, confirm `gh auth status` works before `dot init`; init clones `dotfiles-private` to `~/.config/dotfiles-private` automatically when auth is available.
3. Install bootstrap build prerequisites:

   ```bash
    yay -S --needed git mise-bin
   ```

4. Build the `dot` binary:

   ```bash
   cd ~/.config/dotfiles/dot
   mise --no-config exec bun@latest -- bun install
   mise --no-config exec bun@latest -- bun run build
   ```

5. Run first-use setup:
   - Desktop / VM: `~/.config/dotfiles/scripts/.local/bin/dot init --noninteractive --confirm`
   - Laptop: `dot init --host laptop --noninteractive --confirm`
   - Interactive: `dot init` in an interactive shell
6. If stock Omarchy config directories already exist at `~/.config/waybar`, `~/.config/ghostty`, or `~/.config/uwsm`, `dot init` backs them up with a `.dot-init-backup-*` suffix before cloning the managed repos. Hyprland config is stowed from the `hypr/` package instead.
7. `dot init` opens the managed [firewall rules](/dot/utilities/#firewall-rules) (KDE Connect, Home Assistant, and the OpenCode server) when `ufw` is installed.
8. Restart your shell and confirm `dot help` is on `PATH`.
9. Run `dot git-diff` and verify the expected repo state.
10. Run `dot update` for ongoing sync, stow, rebuild, and init-state backfill.

:::tip[Hypr host and mise tools]
`dot init` selects the Hypr host early (setting `OMARCHY_HOST`), and the stow phase of the final update creates `~/.config/hypr/host`. It runs `mise install` immediately after stowing dotfiles and before installing managed Arch/AUR package lists, so Bun, Node, pnpm, and similar tools come from the stowed mise config rather than global pacman packages. Each `dot update` (and so the final update in `dot init`) also trusts the mise configs in the repos dot tracks, so `mise` never prompts to trust them on this machine.
:::

:::note[GNOME Boxes shared folders]
Arch provides `spice-webdavd` in the `phodav` package. Share a host folder from Boxes and pass `--log <shared-path>/dot-init.log` when you want init output written somewhere visible from the host.
:::
