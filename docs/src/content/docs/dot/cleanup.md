---
title: Cleanup
description: Remove stowed links and manually reverse first-use setup changes.
sidebar:
  order: 8
---

Use this page when you want to remove the changes `dot` made to a machine. The safe first step is always `dot clean`; everything after that is optional and more destructive.

:::caution
Review each command before running it. Some steps remove system config, package repositories, cloned repos, or user services. Do not run the whole page as a script.
:::

## Remove stowed links

`dot clean` only removes symlinks managed by GNU Stow. It unstows the private overlay first, then the public packages.

```bash
dot clean
```

This does not remove packages, cloned repositories, pacman config, firewall rules, systemd user units, shell changes, logs, or backup files.

## Restore backed-up files

`dot install` and `dot init` move conflicting live files into backup paths instead of deleting them. Check the public repo backup directory and any Omarchy init backups before removing the repo.

```bash
ls ~/.config/dotfiles/backup
ls ~/.config/*.dot-init-backup-*
```

Move back only the files you still want to keep.

## Disable user services

Disable user timers/services that were enabled during setup.

```bash
systemctl --user disable --now dot-doctor-startup.timer
systemctl --user disable --now daily-volume-zero.timer
systemctl --user daemon-reload
```

`daily-volume-zero.timer` only exists on laptop stow packages, so the command may report that the unit is missing.

## Remove managed firewall rules

`dot init` adds managed `ufw` allow rules when `ufw` is installed. Delete only the rules you no longer want.

```bash
sudo ufw status numbered
sudo ufw delete <number>
sudo ufw reload
```

The managed rules are labelled in `ufw status` with their purpose, for example KDE Connect, Home Assistant, OpenCode server, LocalSend, and libvirt.

## Remove private pacman repo config

If `dot setup-private-repo` or `dot init` registered the private package repo, remove the include line and snippet manually.

```bash
sudoedit /etc/pacman.conf
sudo rm -f /etc/pacman.d/timmo-private.conf
sudo pacman -Sy
```

Remove this line from `/etc/pacman.conf` if present:

```ini
Include = /etc/pacman.d/timmo-private.conf
```

If your private config overrides `DOT_PRIVATE_PACMAN_REPO_CONFIG` or `DOT_PRIVATE_PACMAN_MAIN_CONFIG`, use those paths instead.

## Remove pacman hooks

Public/private pacman hooks are installed into `/etc/pacman.d/hooks` from stowed hook sources. Remove only hooks that came from these dotfiles.

```bash
ls ~/.config/pacman-hooks
ls /etc/pacman.d/hooks
sudo rm /etc/pacman.d/hooks/<hook-name>.hook
```

## Restore the login shell

`dot init` sets the login shell to zsh when needed. Change it back if you no longer want zsh as the login shell.

```bash
chsh -s /bin/bash "$USER"
```

If init added `/usr/bin/zsh` to `/etc/shells`, leave it unless you know nothing else on the machine needs it.

## Remove cloned repos and state

After the stowed links and system config are removed, delete cloned repos and generated state only if you no longer need them.

```bash
rm -rf ~/.config/dotfiles-private
rm -rf ~/.config/waybar ~/.config/ghostty ~/.config/uwsm
rm -rf ~/repos/private-arch-repo
rm -rf ~/.local/state/dot
```

Do not remove `~/.config/dotfiles` until you no longer need the `dot` binary, docs, or backup directory.

## Remove agent and MCP generated files

`dot agents-sync` and `dot mcp-sync` write generated config into other tool locations. Remove these only if you want those harnesses unmanaged too.

Common generated paths include:

```bash
~/.cursor/rules/global-agents.mdc
~/.config/opencode/mcp.json
```

Private overlays can configure additional harness targets.

## Remove installed packages

`dot init` installs the public/private package lists but does not track ownership of packages afterwards. Removing packages is intentionally manual.

```bash
comm -12 <(sort ~/.config/dotfiles/.dot-public-packages) <(pacman -Qq | sort)
```

Review that output, then remove only packages you no longer use.

```bash
sudo pacman -Rns <package>
```

For private packages, review the private package list before removing anything.

## Final check

Run doctor after cleanup to see what managed state remains. It will report missing dotfiles pieces if the repo is partly removed, which is expected during a full uninstall.

```bash
dot doctor
```
