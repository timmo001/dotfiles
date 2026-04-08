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
- `agents/` - agent tooling: public OpenCode config under `.opencode/`; private overlay adds OpenCode secrets, Claude Code (`.claude/`, `.claude.json`), `~/.config/opencode/`, and Cursor rule output under `.cursor/rules/` (see `dot agents-sync`)
- `cursor/`, `editorconfig/` - editor/tooling config

### Migrating from `opencode/` (renamed to `agents/`)

The stow package was renamed from `opencode` to `agents`. **`dot update`**, **`dot stow`**, and **`dot install`** run a short migration first: if `opencode/` is still present in the public or private repo, they `stow -D opencode` there before pulls or restow (so links are not left pointing at a removed package after you pull).

If you already removed `opencode/` from the repo without unstowing first and see broken links under `~/.opencode/`, run `dot clean` then `dot install`.

### Private `claude/` merged into `agents/`

Claude Code config (`.claude/`, `.claude.json`) now lives under the private **`agents/`** package. **`dot update`**, **`dot stow`**, and **`dot install`** unstow a legacy **`claude/`** package when that directory still exists, before restowing **`agents/`**.

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
- `dot agents-sync` - copy `~/.opencode/AGENTS.md` into `agents/.cursor/rules/global-agents.mdc` in private dotfiles by default (`alwaysApply: true` + body; stows to `~/.cursor/rules/`). **`dot update`** and **`dot diff`** run this automatically by default (see env vars below).

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
- `DOT_AUTO_CD` - zsh wrapper auto-cd to first repo with changes after `dot diff`; otherwise restore original dir (failed diff falls back to `~/.config/dotfiles`) (`1|0`, default `1`)
- `DOT_AGENTS_SYNC_SOURCE` - AGENTS file to mirror (default `~/.opencode/AGENTS.md`)
- `DOT_AGENTS_SYNC_RULE_FILE` - Cursor rule output path (default `$DOTFILES_PRIVATE_DIR/agents/.cursor/rules/global-agents.mdc`, else `~/.cursor/rules/global-agents.mdc`)
- `DOT_AGENTS_SYNC_ON_UPDATE` - run `agents-sync` after `dot update` (`1|0`, default `1`)
- `DOT_AGENTS_SYNC_ON_DIFF` - run `agents-sync` after `dot diff` (`1|0`, default `1`)

## New machine checklist

1. Clone `dotfiles` to `~/.config/dotfiles`
1. Clone `dotfiles-private` to `~/.config/dotfiles-private` (if available)
1. Confirm `gh auth status` works
1. Run `~/.config/dotfiles/scripts/.local/bin/dot doctor`
1. Run `~/.config/dotfiles/scripts/.local/bin/dot init`
1. Restart shell and confirm `dot help` is on `PATH`
1. Run `dot diff` and verify expected repo state
1. Run `dot update` to validate sync + stow end-to-end
