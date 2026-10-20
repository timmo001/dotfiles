# Ubuntu server

This branch, `distro/ubuntu-server`, is a stripped-down copy of the dotfiles for a headless Ubuntu server. It keeps the terminal and service tooling and drops everything that needs a desktop. The server also hosts a Herdr session that other machines attach to.

It branches from `distro/arch-omarchy-quattro` and rebases onto it to pick up shared changes. Look ahead at what is coming, bring in what the server wants and blindly keep the server side for everything else. `AGENTS.md` has the steps.

## What stays

- Shell and prompt: `zsh`, `starship`, `tmux`, `editorconfig`, `ripgrep`. The Omarchy aliases still wanted (eza `ls`, `ff`, `cd` through zoxide, `n` and so on) live in `.zshrc`
- Terminal tools from mise: `btop`, `fastfetch`, `lazygit`, `lazydocker`, `neovim`, `yazi`, `topgrade`, plus `context`, `ha-bridge`, `notes` and `triage`. apt packages come from `.dot-public-packages`
- Agents: `agents` (OpenCode, installed and updated by `dot install`), `pi`, `plannotator`, `dotfiles-skills`, and the shared skills minus the desktop-only ones listed in `.dot-skills.yml`
- Private overlay: `dotfiles-private` stays on its main branch, and `dot` stows only the private packages listed in `.dot-private.yml`, unstowing any dropped from the list. The private `dot-git.yml` and `mcp.yml` are shared, except the MCP servers its `mcp.exclude` keeps off the server and the repositories not tagged `machines: [server]` in `dot-git.yml`. The tagged ones are cloned shallow
- Herdr: `herdr` config and the local plugins under `scripts/.local/share/herdr-plugins/`
- Services: `systemd` user units and `dot services` definitions, plus `herdr`, `ollama` and `ollaya` (on the GPU, listening on the LAN) and `system-bridge`
- System Bridge, installed from its latest release `.deb` by `dot update system` (`.dot-public-deb-releases.yml`)
- The `dot` CLI source, tests, docs site and CI

## What went

Hyprland, UWSM, Ghostty, Omarchy (shell plugins, hooks, patches and plugin submodules), Cursor launchers, pacman hooks, the laptop-only packages and the desktop launcher scripts. The OOM slice override went too, since it only covered UWSM-launched apps.

Later desktop additions are dropped as they come in: the dot links Chromium extension and its native host, the background link opener, the Plannotator Inbox window and bar plugin, and their desktop entries. `VISUAL` points at Neovim rather than Cursor.

`dot` itself has its desktop code removed rather than switched off: the `omarchy`, `workspace`, `link` and pacman repository commands, the Omarchy and browser doctor checks, and the host-suffixed packages. Packages install with apt, `dot update system` runs apt, the release `.deb` packages and topgrade, and failure notifications go to the journal.

## Server dashboard

`dot server serve` serves a small web dashboard and its API: the registered `dot services` with their health, recent logs, and start and stop. The dashboard source is in `server/` (Vite and Lit, sharing the API schema in `dot/src/server/api.ts`).

Pitchfork keeps it running, configured in `pitchfork.toml`. It rebuilds the dashboard on each start and listens on port 7700 on the LAN.

```bash
mise run serve:server          # start through pitchfork
mise run serve:server:logs     # follow its logs
mise run serve:server:restart  # rebuild and restart after a pull
```

Everything except `/api/health` needs a login with the token in `~/.config/dot/server/token`, which the private `systemd--nas` secret file writes from 1Password. It is still plain HTTP, so keep it on the LAN. Planned next:

- [x] Auth: a token login with a password field, so 1Password saves it
- [ ] Reach it from outside the house over HTTPS through a NAS Cloudflare tunnel, optionally behind Cloudflare Access
- [ ] Run `dot update` and other maintenance tasks from the dashboard, with live output in a web terminal
- [ ] Summaries of the nightly `compose-up` logs

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

## Switching the server over

Done on the NAS in October 2026: the old checkout was backed up and unstowed, this branch cloned and `dot init` run, the old Herdr and System Bridge units swapped for the user units, and the hand-installed tools (linuxbrew, `/opt/nvim`, `/usr/local/bin/ollama`, the topgrade `.deb`, `~/.opencode/bin`, mise's System Bridge) and the `update-mise` crontab line removed. Pitchfork starts the dashboard at boot. `dot doctor` and `dot update system` run cleanly.

## Still open

Check these from a local session on the server. Items tied to a file are also marked `TODO(ubuntu-server)` there, so `rg 'TODO\(ubuntu-server\)'` finds them in place.

### Tools

- [x] Neovim gets the same LazyVim setup as Omarchy's `omarchy-nvim`: the LazyVim starter, Omarchy's options and plugins, and a fixed Tokyo Night theme in place of Omarchy's theme link and hot reload

### Services

- [x] Run `ha-bridge.service` on the server for local agent use, such as reading the Home Assistant automation that controls when the NAS is up. Shared jobs (the bar, `dot-brief`, `dot-brief-follow-up`) stay on the desktop, since the NAS is not always on, and their units are removed here. `triage-agent` runs here with its own token from `triage--nas`; `notes-capture-daemon` and `dot-deps` are dropped from the server
- [x] Once `ha-bridge` runs here, name the automation that controls the NAS in `AGENTS.md`
- [x] Leave `dot-notifications-dismiss.timer` to the desktops. Its units are removed here, so `dot stow` has nothing to enable
- [x] Move the nightly `compose-up` crontab line to the private `systemd--nas` timer, at 02:00 inside the maintenance window
- [x] Failure notifications: none needed. Triage collects failed units and journal errors from the NAS for the next day

### Herdr

- [x] Check whether the desktop Herdr swallows the `alt+x` prefix when the server is attached from inside it
- [x] Check whether sounds play on the client when attached remotely: they do
- [x] Check the Plannotator review binding from a remote client, and where reviews open now `PLANNOTATOR_BROWSER` is unset. Moved to #1133
- [x] Check the `dotfiles.dot-links` plugin: `file://` and web links work from a remote client. `dot://` links don't, since `dot link` is desktop-only, and that's fine
- [x] Confirm the `herdr-lazy` plugins all work headless

### Branch upkeep

- [x] Automate the rebase onto `distro/arch-omarchy-quattro`: the Server rebase workflow on the desktop branch force-pushes a clean rebase that adds no files and passes the checks, and otherwise opens an issue for the `server-rebase` skill in OpenCode

### Private overlay

- [x] Check the private packages `.dot-private.yml` selects stow cleanly on the NAS, and that `chrome-devtools` shows as disabled in OpenCode there
