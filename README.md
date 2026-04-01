# Dotfiles

My public Arch/Omarchy dotfiles, managed with GNU Stow and the `dot` command.

## At a glance

- Stow-based dotfiles rooted at `~/.config/dotfiles`
- Public config for shell, editor, and tooling
- One command entrypoint at `scripts/.local/bin/dot`
- Optional private overlays from `~/.config/dotfiles-private`
- Omarchy repo sync for `bootstrap`, `hypr`, `waybar`, `ghostty`, and `uwsm`

## Repository layout

- `scripts/.local/bin/dot` - main command entrypoint
- `.stowrc` - stow target and ignore rules
- `zsh/` - shell config
- `neovim/` - Neovim config
- `starship/` - prompt config
- `opencode/` - OpenCode config
- `cursor/`, `editorconfig/` - editor/tooling config

## Quick start

```bash
# Before dot is on PATH
~/.config/dotfiles/scripts/.local/bin/dot help

# Typical workflow
dot init
dot update
dot diff
dot doctor
```

## Command reference

- `dot init` - questionnaire (when available), Omarchy sync, package setup, then public/private install
- `dot update` - Omarchy + public/private pull, then stow refresh
- `dot stow` - stow refresh only (no git pull)
- `dot diff` - git status + staged/unstaged summaries across managed repos
- `dot setup [--confirm]` - package install step only
- `dot install` - backup/adopt install flow for public/private dotfiles
- `dot clean` - unstow private then public
- `dot doctor` - tool, repo, and remote health checks

## Environment options

- `DOTFILES_PUBLIC_DIR` - public dotfiles path (default `~/.config/dotfiles`)
- `DOTFILES_PRIVATE_DIR` - private dotfiles path (default `~/.config/dotfiles-private`)
- `DOT_ALLOW_PRIVATE` - `auto|always|never` (default `auto`)
- `DOT_PRIVATE_GH_USER` - expected GitHub user for private actions (default `timmo001`)
- `OMARCHY_REPO_BASE_DIR` - Omarchy repo base path (default `~/.config`)
- `DOT_OMARCHY_BRANCH` - branch for `hypr/waybar/ghostty/uwsm` sync
- `DOT_BOOTSTRAP_BRANCH` - branch for `bootstrap` sync (default `distro/omarchy`)
- `DOT_INCLUDE_OMARCHY_DIFF_REPOS` - include Omarchy repos in `dot diff` (`1|0`, default `1`)
- `DOT_INCLUDE_OMARCHY_UPDATE_REPOS` - include Omarchy repos in `dot update` sync (`1|0`, default `1`)
- `DOT_INIT_NONINTERACTIVE` - skip init questionnaire (`1|0`, default `0`)
- `DOT_AUTO_CD` - zsh wrapper auto-cd to `~/.config/dotfiles` after successful command (`1|0`, default `1`)

## New machine checklist

1. Clone `dotfiles` to `~/.config/dotfiles`
1. Clone `dotfiles-private` to `~/.config/dotfiles-private` (if available)
1. Confirm `gh auth status` works
1. Run `~/.config/dotfiles/scripts/.local/bin/dot doctor`
1. Run `~/.config/dotfiles/scripts/.local/bin/dot init`
1. Restart shell and confirm `dot help` is on `PATH`
1. Run `dot diff` and verify expected repo state
1. Run `dot update` to validate sync + stow end-to-end
