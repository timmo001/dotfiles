---
title: Cleanup
description: Remove stowed links and manually reverse first-use setup changes.
---

Use this page when you want to remove the changes `dot` made to a machine. The safe first step is always `dot clean`; everything after that is optional and more destructive.

:::caution
Review each command before running it. Some steps remove system config, package repositories, cloned repos, or user services. Do not run the whole page as a script.
:::

## Remove stowed links

`dot clean` only removes symlinks managed by GNU Stow. It unstows the private overlay first when it is available, then the public packages.

```bash
dot clean
```

This does not remove packages, cloned repositories, pacman config, firewall rules, systemd user units, shell changes, generated agent instruction copies, logs, or backup files.

## Restore backed-up files

`dot install`, `dot init`, and `dot stow` move conflicting live files into backup paths instead of deleting them. Check the public/private repo backup directories and any Omarchy init backups before removing the repos.

```bash
ls ~/.config/dotfiles/backup
ls ~/.config/dotfiles-private/backup
ls ~/.config/*.dot-init-backup-*
```

Move back only the files you still want to keep.

## Disable user services

Disable user timers/services that were enabled from these dotfiles.

```bash
systemctl --user disable --now dot-doctor-startup.timer
systemctl --user disable --now daily-volume-zero.timer
systemctl --user disable --now git-workflow-watch.timer git-workflow-watch.service
systemctl --user reset-failed git-workflow-watch.timer git-workflow-watch.service
systemctl --user daemon-reload
```

`daily-volume-zero.timer` only exists on laptop stow packages, and `git-workflow-watch.*` are obsolete legacy units, so these commands may report that some units are missing.

## Remove synced agent instruction copies

`dot init` runs `dot agents-sync`, which mirrors the global OpenCode agent instructions into other harnesses. Remove these only if you want those harnesses unmanaged too. Check for the `dot agents-sync` header before deleting anything you may have edited by hand.

```bash
grep -H "dot agents-sync" ~/.cursor/rules/global-agents.mdc ~/.claude/CLAUDE.md
rm -f ~/.cursor/rules/global-agents.mdc ~/.claude/CLAUDE.md
```

## Remove managed firewall rules

`dot init` adds managed `ufw` allow rules when `ufw` is installed. Delete only the rules you no longer want.

```bash
sudo ufw status numbered
sudo ufw delete <number>
sudo ufw reload
```

The managed rules are labelled in `ufw status` with their purpose, for example KDE Connect, Home Assistant, OpenCode server, LocalSend, and libvirt.

## Remove public pacman repo config

Remove the managed include and snippet, then refresh package databases. Do not replace the signed configuration with `TrustAll` or another relaxed signature policy.

```bash
sudoedit /etc/pacman.conf
sudo rm -f /etc/pacman.d/timmo.conf
sudo pacman-key --delete F94469C08E3B717014E2815FA026A3671E9151DA
sudo pacman -Syu
```

Remove this line from `/etc/pacman.conf` if present:

```ini
Include = /etc/pacman.d/timmo.conf
```

Existing installed packages remain installed. AUR helpers remain available and can build subsequent versions from AUR. To recover a damaged or removed setup, run `dot setup-public-repo`; it downloads the key again and refuses to trust it unless the full fingerprint matches.

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

`dot setup-private-repo` also syncs a local `file://` mirror from the private package repo config. If you want to remove that mirror and source clone too, check `path=` and `mirror_path=` in `~/.config/dotfiles-private/.dot-private-package-repo` and remove only those directories.

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

## Remove Git config include

`dot init` adds the managed Git include to your global Git config. Remove it if you no longer want Git to load the stowed dotfiles settings.

```bash
git config --global --fixed-value --unset-all include.path "~/.config/git/config.dotfiles"
```

## Revert generated locales

`dot init` ensures `en_GB.UTF-8` is enabled in `/etc/locale.gen` and runs `locale-gen`. Leave the locale in place unless you specifically want to remove it.

```bash
sudoedit /etc/locale.gen
sudo locale-gen
```

## Remove cloned repos and state

After the stowed links and system config are removed, delete cloned repos and generated state only if you no longer need them.

```bash
rm -rf ~/.config/dotfiles-private
rm -rf ~/.config/bootstrap ~/.config/waybar ~/.config/uwsm
rm -rf ~/.local/state/dot ~/.cache/dot
```

Private package repos and other private Git clones are configured by the private overlay. Review `~/.config/dotfiles-private/.dot-private-package-repo` and `~/.config/dotfiles-private/dot-git.yml`, then remove only clones and mirrors you no longer need.

If you removed Omarchy config directories that `dot init` replaces with managed repos, or stowed config directories that Omarchy should own again, refresh the stock Omarchy defaults afterwards.

```bash
omarchy refresh waybar
omarchy refresh shell
omarchy refresh hyprland
omarchy refresh config ghostty/config
omarchy refresh config uwsm/env
```

Run `omarchy refresh --help` on the target machine for the exact refresh commands supported by that Omarchy version.

Do not remove `~/.config/dotfiles` until you no longer need the `dot` binary, docs, or backup directory.

## Remove installed packages

`dot init` installs the public/private package lists but does not track ownership of packages afterwards. Removing packages is intentionally manual. This command only covers the default public package list; if you override `DOT_PUBLIC_PACKAGES_FILE`, use that file instead.

```bash
comm -12 <(sort ~/.config/dotfiles/.dot-public-packages) <(pacman -Qq | sort)
```

Review that output, then remove only packages you no longer use.

```bash
sudo pacman -Rns <package>
```

For private packages, review the private package list before removing anything.

`dot install` and `dot init` may also install setup prerequisites such as `stow`, `gum`, or `mise` when they are missing. Remove those manually only if nothing else uses them.

## Remove mise-managed tools

`dot init` runs `mise install`, which can install language and CLI tool versions from the stowed mise config. Remove only versions you no longer use.

```bash
mise ls --installed
mise uninstall <tool@version>
```

## Remove GitHub CLI extensions

`dot init` installs the GitHub CLI extensions listed in `.dot-gh-extensions` when `gh` is available. Remove only extensions you no longer want.

```bash
gh extension list
gh extension remove <owner/repo>
```

## Final check

Run doctor after cleanup to see what managed state remains. It will report missing dotfiles pieces if the repo is partly removed, which is expected during a full uninstall.

```bash
dot doctor
```
