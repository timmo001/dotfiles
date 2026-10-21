# Dotfiles

![Dotfiles](.github/social-preview.png)

Personal dotfiles for cloud agent environments, starting with [Claude Code cloud sessions](https://code.claude.com/docs/en/claude-code-on-the-web), built around the `dot` command.

> [!NOTE]
> This is the `distro/cloud` branch: the [Ubuntu server build](https://github.com/timmo001/dotfiles/tree/distro/ubuntu-server) cut down for a short-lived session VM. It builds `dot` and sets up Claude Code's user settings, instructions and skills; nothing is stowed and no services run. The desktop setup lives on `distro/arch-omarchy-quattro`.

**Docs:** <https://cloud.dotfiles.timmo.dev> (server: <https://ubuntu-server.dotfiles.timmo.dev>, desktop: <https://dotfiles.timmo.dev>)

> [!CAUTION]
> This repository is for reference. The configs are tuned for my own cloud environment, with a private overlay that is not public, so pointing your setup script at it is not recommended. Have your agents borrow the pieces you want instead.

## Quick start

Set a Claude Code cloud environment's setup script to:

```bash
#!/bin/bash
curl -fsSL https://raw.githubusercontent.com/timmo001/dotfiles/distro/cloud/cloud/setup.sh | bash
```

The script clones this branch, installs mise and the pinned toolchain, builds `dot` and runs `dot cloud setup`. A session start hook in the Claude Code settings then pulls the latest branch and adds the private global instructions.

## Docs map

- [Overview](https://cloud.dotfiles.timmo.dev/)
- [Getting started](https://cloud.dotfiles.timmo.dev/getting-started/)
- [Claude Code](https://cloud.dotfiles.timmo.dev/claude/overview/)
- [Configuration](https://cloud.dotfiles.timmo.dev/configuration/)
- [Distros](https://cloud.dotfiles.timmo.dev/distros/)
- [`dot`](https://cloud.dotfiles.timmo.dev/dot/overview/) · [command reference](https://cloud.dotfiles.timmo.dev/dot/commands/)
- [Agents](https://cloud.dotfiles.timmo.dev/agents/overview/) · [skills](https://cloud.dotfiles.timmo.dev/agents/skills/)
- [OpenCode](https://cloud.dotfiles.timmo.dev/agents/opencode/overview/) · [agents](https://cloud.dotfiles.timmo.dev/agents/opencode/agents/) · [commands](https://cloud.dotfiles.timmo.dev/agents/opencode/commands/) · [plugins](https://cloud.dotfiles.timmo.dev/agents/opencode/plugins/)
- [Stow packages](https://cloud.dotfiles.timmo.dev/stow/) · [changes from the desktop](https://cloud.dotfiles.timmo.dev/server/changes/)

Detail lives in code and `--help`. The site stays a short what-and-why reference.

## Layout

- `cloud/` — setup script, Claude Code settings and cloud notes
- `dot/` — `dot` CLI source
- `docs/` — docs site
- `agents/` — OpenCode config
