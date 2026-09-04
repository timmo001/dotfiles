# 🧰 Dotfiles

Personal [Omarchy](https://omarchy.org) dotfiles, managed with [GNU Stow](https://www.gnu.org/software/stow/) and the `dot` command.

**Docs:** <https://dotfiles.timmo.dev>

> [!CAUTION]
> This repository is for reference. The configs are tuned for Omarchy and my machines, with a private overlay that is not public, so installation is not recommended; borrow pieces rather than installing wholesale. The shared OpenCode config is the exception: [`opencode-config`](https://github.com/timmo001/opencode-config).

## Quick start

```bash
# Public source of truth; stow packages live under this checkout
git clone git@github.com:timmo001/dotfiles.git ~/.config/dotfiles

# Private overlay clone during init needs an authenticated gh
gh auth status || gh auth login

cd ~/.config/dotfiles

# Allow this repo's mise.toml, then install the pinned toolchain
mise trust
mise install

# Build the checked-out binary before it is on PATH
mise run dot:build

# First-use setup (pulls private overlay when gh auth works)
~/.config/dotfiles/scripts/.local/bin/dot init
```

Ongoing: `dot doctor` (health checks), `dot update` (pull, stow, rebuild).

## Docs map

- [Overview](https://dotfiles.timmo.dev/)
- [Getting started](https://dotfiles.timmo.dev/getting-started/)
- [Configuration](https://dotfiles.timmo.dev/configuration/)
- [`dot`](https://dotfiles.timmo.dev/dot/overview/) · [command reference](https://dotfiles.timmo.dev/dot/commands/)
- [Hyprland](https://dotfiles.timmo.dev/desktop/hyprland/) · [Ghostty](https://dotfiles.timmo.dev/desktop/ghostty/) · [Herdr](https://dotfiles.timmo.dev/desktop/herdr/) · [UWSM](https://dotfiles.timmo.dev/desktop/uwsm/) · [Omarchy Shell](https://dotfiles.timmo.dev/desktop/omarchy-shell/)
- [Stow packages](https://dotfiles.timmo.dev/stow/)
- [OpenCode](https://dotfiles.timmo.dev/agents/opencode/overview/) · [agents](https://dotfiles.timmo.dev/agents/opencode/agents/) · [commands](https://dotfiles.timmo.dev/agents/opencode/commands/) · [plugins](https://dotfiles.timmo.dev/agents/opencode/plugins/) ([skills](https://github.com/timmo001/skills))
- [Pi](https://dotfiles.timmo.dev/agents/pi/) · [Cursor](https://dotfiles.timmo.dev/agents/cursor/)

Detail lives in code and `--help`. The site stays a short what-and-why reference.

## Layout

- `dot/` — `dot` CLI source
- `docs/` — docs site
- `agents/` — OpenCode config and pinned skills submodule
- `hypr/`, `uwsm/`, `ghostty/` — desktop packages
- Stow packages for shell, editor, and related tools
