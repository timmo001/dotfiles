# 🧰 Dotfiles

Personal [Omarchy](https://omarchy.org) dotfiles, managed with GNU Stow and the `dot` command.

**Docs:** <https://dotfiles.timmo.dev>

> [!CAUTION]
> Tuned for Omarchy and my machines, with a private overlay that is not public. Borrow pieces; do not install wholesale. The shared OpenCode config is the exception: [`opencode-config`](https://github.com/timmo001/opencode-config).

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
- [`dot`](https://dotfiles.timmo.dev/dot/) · [command reference](https://dotfiles.timmo.dev/dot/commands/)
- [Hyprland](https://dotfiles.timmo.dev/hyprland/) · [Ghostty](https://dotfiles.timmo.dev/ghostty/) · [Herdr](https://dotfiles.timmo.dev/herdr/) · [UWSM](https://dotfiles.timmo.dev/uwsm/) · [Shell](https://dotfiles.timmo.dev/shell/)
- [Stow packages](https://dotfiles.timmo.dev/stow/)
- [OpenCode](https://dotfiles.timmo.dev/opencode/) · [Pi](https://dotfiles.timmo.dev/pi/) · [Cursor](https://dotfiles.timmo.dev/cursor/)
- [Reference](https://dotfiles.timmo.dev/reference/agents/) (generated catalogues)
- [Agents / LLMs](https://dotfiles.timmo.dev/agents-llms/)

Detail lives in code and `--help`. The site stays a short what-and-why reference.

## Layout

- `dot/` — `dot` CLI source
- `docs/` — docs site
- `agents/` — OpenCode config and pinned skills submodule
- `hypr/`, `uwsm/`, `ghostty/` — desktop packages
- Stow packages for shell, editor, and related tools
