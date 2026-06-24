---
title: Environment Variables
description: All DOT_*, DOTFILES_*, and OMARCHY_* options that influence dot.
---

These variables tune paths and behaviour for `dot`. Most have sensible defaults; set them only when you need to override the default.

## Paths and overlay

| Variable | Description |
| --- | --- |
| `DOTFILES_PUBLIC_DIR` | Public dotfiles path (default `~/.config/dotfiles`). |
| `DOTFILES_PRIVATE_DIR` | Private dotfiles path (default `~/.config/dotfiles-private`). |
| `DOT_ALLOW_PRIVATE` | `auto\|always\|never` (default `auto`). |
| `DOT_PRIVATE_GH_USER` | Expected GitHub user for private actions (default `timmo001`). |

## Git and GitHub

| Variable | Description |
| --- | --- |
| `DOT_GIT_CONFIG_FILE` | Private git repo config for `git-diff`, `git-log`, `git-workflows`, `git-notifications --bar-json`, `update`, and `doctor` (default `$DOTFILES_PRIVATE_DIR/dot-git.yml`). |
| `DOT_INCLUDE_OMARCHY_DIFF_REPOS` | Include Omarchy repos in `dot git-diff` (`1\|0`, default `1`). |
| `DOT_INCLUDE_OMARCHY_UPDATE_REPOS` | Include Omarchy repos in `dot update` sync (`1\|0`, default `1`). |
| `DOT_FETCH_TTL_SECONDS` | Seconds to reuse the last upstream fetch (default `300`). |
| `DOT_AUTO_CD` | zsh wrapper auto-cd to the first repo with changes after `dot git-diff` (`1\|0`, default `1`). |

## Private packages

| Variable | Description |
| --- | --- |
| `DOT_PRIVATE_PACKAGE_REPO_FILE` | Private pacman repo config (default `$DOTFILES_PRIVATE_DIR/.dot-private-package-repo`). |
| `DOT_PRIVATE_PACKAGES_FILE` | Private package list (default `$DOTFILES_PRIVATE_DIR/.dot-private-packages`). |
| `DOT_PRIVATE_PACMAN_REPO_CONFIG` | Pacman repo snippet path written by `dot` (default `/etc/pacman.d/timmo-private.conf`). |

## Omarchy and Hyprland

| Variable | Description |
| --- | --- |
| `OMARCHY_REPO_BASE_DIR` | Omarchy repo base path (default `~/.config`). |
| `OMARCHY_HOST` | Hypr host override name; `dot init` defaults to `desktop` when unset unless `--host <name>` is passed. |
| `DOT_OMARCHY_BRANCH` | Branch override for non-bootstrap Omarchy repos during sync. |
| `DOT_BOOTSTRAP_BRANCH` | Branch for `bootstrap` sync (default `distro/omarchy`). |

## Init and timers

| Variable | Description |
| --- | --- |
| `DOT_INIT_NONINTERACTIVE` | Force non-interactive init mode (`1\|0`, default `0`). |
| `DOT_INIT_LOG_FILE` | Default `dot init` log path when `--log` is not passed (default `/tmp/dot-init.log`). |
| `DOT_UFW_RULES_FILE` | ufw rules file scanned by the firewall setup and doctor check (default `/etc/ufw/user.rules`). |
| `DOT_DAILY_VOLUME_ZERO_TIMER_UNIT` | 5am volume reset timer unit name (default `daily-volume-zero.timer`). |

## Agents sync

| Variable | Description |
| --- | --- |
| `DOT_AGENTS_SYNC_SOURCE` | AGENTS file to mirror (default `~/.config/opencode/AGENTS.md`). |
| `DOT_AGENTS_SYNC_RULE_FILE` | Cursor rule output path (default `$DOTFILES_PRIVATE_DIR/agents/.cursor/rules/global-agents.mdc`, else `~/.cursor/rules/global-agents.mdc`). |
| `DOT_AGENTS_SYNC_ON_UPDATE` | Run `agents-sync` after `dot update` (`1\|0`, default `1`). |

## Notes

| Variable | Description |
| --- | --- |
| `NOTES` | Notes vault git repo used by `dot notes` and OpenCode note commands (preferred; default `~/Documents/notes`). |
| `DOT_NOTES_DIR` | Compatibility notes vault override used when `NOTES` is unset. |
