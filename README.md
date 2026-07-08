# 🧰 Dotfiles

My public [Omarchy](https://omarchy.org) dotfiles, managed with GNU Stow and the `dot` command.

**Full documentation:** <https://dotfiles.timmo.dev>

> [!CAUTION]
> These are my personal dotfiles, tightly tuned for [Omarchy](https://omarchy.org) (an Arch Linux based distro) and my specific machines. They are **not** meant to be installed as-is by anyone else: they are unlikely to work on plain Arch without replicating my setup, and they lean on a deeply integrated private overlay (`dotfiles-private`) that is not public, so the public repo alone is an incomplete picture. Use them as a reference to borrow from, or pull individual pieces into your own dotfiles. The shared OpenCode config is the exception: it is generated from this repo and published as [`opencode-config`](https://github.com/timmo001/opencode-config), written to be portable and reusable on its own.
>
> Much of this project, including the documentation and a lot of the code, is generated or heavily assisted by LLMs and coding agents.

## At a glance

- Stow-based dotfiles rooted at `~/.config/dotfiles`, applied with the `dot` command
- A single compiled binary at `scripts/.local/bin/dot` (Bun + Effect v4 + OpenTUI) with a TUI dashboard and a full CLI
- Git/GitHub tooling: diff, log, status, workflow runs, and a notification inbox across managed repos, with Waybar modules
- Managed Omarchy repos (`bootstrap`, `waybar`, `uwsm`) and stowed Hyprland/Ghostty config
- Optional private overlay from `~/.config/dotfiles-private`
- Shared OpenCode agents, commands, skills, and plugins, published to [`timmo001/opencode-config`](https://github.com/timmo001/opencode-config)

## Quick start

```bash
# Fresh Omarchy machine bootstrap prerequisites
yay -S --needed git mise-bin

# Clone public dotfiles. For private dotfiles, authenticate gh before dot init;
# init clones dotfiles-private automatically when gh auth works.
git clone git@github.com:timmo001/dotfiles.git ~/.config/dotfiles
gh auth status || gh auth login

# Build the checked-out dot binary before it is on PATH.
cd ~/.config/dotfiles
mise trust
mise install
mise run dot:build

# One-time first-use setup.
~/.config/dotfiles/scripts/.local/bin/dot init --noninteractive --confirm

# Ongoing workflow after restarting the shell
dot doctor
dot update
dot git-diff
```

See the [install guide](https://dotfiles.timmo.dev/getting-started/install/) and [new machine checklist](https://dotfiles.timmo.dev/getting-started/new-machine/) for the full walkthrough.

## Documentation

Everything is documented at <https://dotfiles.timmo.dev>:

- [Getting Started](https://dotfiles.timmo.dev/getting-started/) — install and new-machine checklist
- [The `dot` Command](https://dotfiles.timmo.dev/dot/) — TUI + CLI, with the full [command reference](https://dotfiles.timmo.dev/dot/commands/), [stow workflow](https://dotfiles.timmo.dev/dot/stow/), [notes & handoffs](https://dotfiles.timmo.dev/dot/notes/), and [system utilities](https://dotfiles.timmo.dev/dot/utilities/)
- [Git & GitHub](https://dotfiles.timmo.dev/git/) — diff, log, status, workflows, notifications
- [Omarchy & Hyprland](https://dotfiles.timmo.dev/omarchy/) — managed repos and host overrides
- [OpenCode & Agents](https://dotfiles.timmo.dev/opencode/) — agents, commands, skills, plugins, and the generated reference
- [Configuration & Reference](https://dotfiles.timmo.dev/configuration/) — environment options, private git config, and [private packages](https://dotfiles.timmo.dev/configuration/private-packages/)
- [Bar Integrations](https://dotfiles.timmo.dev/bar-integrations/) — the `--bar-json` status-bar contract shared by `dot` and external tools
- [Agents / LLMs](https://dotfiles.timmo.dev/agents-llms/) — context bundles for AI-assisted work

## Repository layout

- `dot/` — TypeScript source for the `dot` binary (excluded from stow)
- `docs/` — the documentation site at <https://dotfiles.timmo.dev> (Astro + Starlight; excluded from stow)
- `scripts/.local/bin/dot` — compiled binary (stowed to `~/.local/bin/dot`)
- `.stowrc` — stow target and ignore rules
- `zsh/`, `neovim/`, `starship/`, `editorconfig/` — shell, editor, and prompt config
- `agents/` — OpenCode config (`.config/opencode/`) and shared skills (`.agents/skills/`), published to [`opencode-config`](https://github.com/timmo001/opencode-config)
- `hypr/` — Hyprland config (stowed with `--no-folding`, per-host overrides)
- `ghostty/` — Ghostty config, host overrides, launcher, and desktop entry

The documentation is the single source of truth; this README links to it rather than duplicating content. The `dot` command reference and the OpenCode reference on the docs site are generated from `dot/src/cli/spec.ts` and the OpenCode assets respectively.
