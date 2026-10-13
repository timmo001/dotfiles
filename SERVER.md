# Ubuntu server

This branch, `distro/ubuntu-server`, is a stripped-down copy of the dotfiles for a headless Ubuntu server. It keeps the terminal and service tooling and drops everything that needs a desktop. The server also hosts a Herdr session that other machines attach to.

It branches from `distro/arch-omarchy-quattro`. Pull shared changes across with a merge, then drop anything desktop-only again.

## What stays

- Shell and prompt: `zsh`, `starship`, `tmux`, `editorconfig`, `ripgrep`
- Terminal tools: `btop`, `fastfetch`, `lazygit`, `neovim`, `yazi`, `topgrade`, `mise`
- Agents: `agents` (OpenCode), `pi`, `plannotator`, `dotfiles-skills`
- Herdr: `herdr` config and the local plugins under `scripts/.local/share/herdr-plugins/`
- Services: `systemd` user units and `dot services` definitions, plus a new `herdr.service`
- The `dot` CLI source, tests, docs site and CI

## What went

Hyprland, UWSM, Ghostty, Omarchy (shell plugins, hooks, patches and plugin submodules), Cursor launchers, pacman hooks, the laptop-only packages and the desktop launcher scripts. The OOM slice override went too, since it only covered UWSM-launched apps.

Later desktop additions are dropped as they come in: the dot links Chromium extension and its native host, the background link opener, the Plannotator Inbox window and bar plugin, and their desktop entries. `VISUAL` points at Neovim rather than Cursor.

## Herdr as a remote machine

The server runs the Herdr server under systemd and clients attach over SSH.

```bash
# On the server, once
loginctl enable-linger "$USER"
systemctl --user enable --now herdr.service

# From another machine
herdr --remote <host>
```

The config matches the desktop's keys, theme and sidebar, with sounds off.

## To do on the real server

Every open item below is also marked `TODO(ubuntu-server)` in the file it affects, so `rg 'TODO\(ubuntu-server\)'` finds them in place. Work through these from a local session on the server.

### `dot`

The CLI still assumes Omarchy and pacman. Nothing under `dot/` has changed yet, so check each of these before relying on it:

- [ ] `dot init` and `dot install` on Ubuntu, including the private overlay clone
- [ ] `dot stow` runs the Omarchy Neovim theme, crash-capture and shell-config steps. Make them skip cleanly without Omarchy
- [ ] Package setup installs `.dot-public-packages` with pacman. Add an apt path
- [ ] `dot update system` drives pacman and Omarchy updates. Decide what it should run here (apt, topgrade or both)
- [ ] `dot herdr start` and `restart` launch through `uwsm-app`. Make them use `herdr.service` when there is no graphical session
- [ ] `dot services notify` sends failures through `omarchy notification`. Pick a headless channel (journal, ntfy, Home Assistant)
- [ ] `dot doctor` checks for pacman hooks, the Hypr host link, Omarchy and the dot links extension. Skip or replace them on the server
- [ ] `dot plannotator inbox` opens a Qt WebEngine window. Decide whether the server needs an Inbox at all, or only posts to the desktop's
- [ ] Host-suffixed packages (`systemd--desktop` and so on) key off `OMARCHY_HOST`, which UWSM set on the desktop. Set it for the server, for example in `~/.zsh_profile` and the systemd user environment

### Packages and tools

- [ ] Check `.dot-public-packages` against the server's Ubuntu release
- [ ] Choose install methods for the AUR-only tools listed in `.dot-public-packages`
- [ ] Review the global mise tools for the server (`android-sdk`, `ollama` and `ollaya` may not be wanted)
- [ ] Neovim config assumes the LazyVim base that Omarchy installs. Install LazyVim, or drop the `neovim` package
- [ ] Port any Omarchy shell aliases and functions still wanted into `.zshrc`
- [ ] Confirm the zsh plugin paths for autosuggestions and syntax highlighting

### Services

- [ ] Confirm `herdr server` stays in the foreground under `Type=simple`
- [ ] Decide which of `ha-bridge`, `upnext`, `triage-agent`, `notes-capture-daemon`, `dot-brief` and `dot-brief-follow-up` run on the server, so they do not run twice alongside the desktop
- [ ] `dot stow` enables `dot-notifications-dismiss.timer` on every machine. It is safe to run twice, but one machine is enough
- [ ] `pitchfork.service` pins an absolute mise install path with the desktop's user name
- [ ] Decide where `dot doctor` failures surface now there is no desktop notification

### Herdr

- [ ] Check whether the desktop Herdr swallows the `alt+x` prefix when the server is attached from inside it
- [ ] Check whether sounds play on the client when attached remotely
- [ ] Check the Plannotator review binding from a remote client, and where reviews open now `PLANNOTATOR_BROWSER` is unset
- [ ] Check the `dotfiles.dot-links` plugin: `file://` links open Neovim in Herdr, but `dot://` links target the desktop Git panel
- [ ] Confirm the `herdr-lazy` plugins all work headless

### Private overlay

- [ ] Decide how `dotfiles-private` serves the server: its own branch, or `--server` host packages. It still carries Omarchy, UWSM, pacman and yay packages
