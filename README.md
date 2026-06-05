# Dotfiles

My public Arch/Omarchy dotfiles, managed with GNU Stow and the `dot` command.

## At a glance

- Stow-based dotfiles rooted at `~/.config/dotfiles`
- Public config for shell, editor, and tooling
- Single compiled binary at `scripts/.local/bin/dot` (Bun + Effect v4 + OpenTUI)
- TUI dashboard with git diff/log views, GitHub workflow runs, GitHub notifications, repo notes, omarchy menus, git staging, and AI commit suggestions
- Optional private overlays from `~/.config/dotfiles-private`
- Omarchy repo sync for `bootstrap`, `hypr`, `waybar`, `ghostty`, and `uwsm`
- GitHub workflow run status and notification inbox via `dot git-workflows`, `dot git-notifications`, and Waybar

## Repository layout

- `dot/` - TypeScript source for the `dot` binary (excluded from stow)
- `scripts/.local/bin/dot` - compiled binary (stowed to `~/.local/bin/dot`)
- `.stowrc` - stow target and ignore rules
- `zsh/` - shell config
- `neovim/` - Neovim config
- `starship/` - prompt config
- `agents/` - agent tooling: public OpenCode (`.opencode/`), Cursor launcher script (`.local/bin/cursor`); private overlay adds `~/.cursor/` (`argv.json`, `mcp.json`, rules), Claude Code, OpenCode secrets, `~/.config/opencode/` (see `dot agents-sync`). OpenCode skills, agents, commands, and plugins are published to [`timmo001/opencode-config`](https://github.com/timmo001/opencode-config) automatically on push.
- `editorconfig/` - editor config

## Omarchy Host Overrides

- `hypr`, `waybar`, `ghostty`, and `uwsm` are single-branch Omarchy repos expected on `main`.
- `bootstrap` is expected on `distro/omarchy`.
- Hypr host-specific overrides live under `~/.config/hypr/hosts/$OMARCHY_HOST`.
- `dot stow` creates `~/.config/hypr/host` as the active host symlink and `dot doctor` checks it.
- If this host override setup changes, update the relevant `README.md`, `AGENTS.md`, and skill documentation together so the documented layout stays accurate.

## Quick start

```bash
# Fresh Arch/Omarchy machine bootstrap prerequisites
sudo pacman -S --needed git mise

# Clone public dotfiles first. If private dotfiles are wanted, authenticate gh
# before dot init; init clones dotfiles-private automatically when gh auth works.
git clone git@github.com:timmo001/dotfiles.git ~/.config/dotfiles
gh auth status || gh auth login

# Build the checked-out dot binary before it is on PATH.
cd ~/.config/dotfiles/dot
mise --no-config exec bun@latest -- bun install
mise --no-config exec bun@latest -- bun run build

# First-use setup logs to /tmp/dot-init.log by default, stows configs,
# installs mise tools, and ends with dot update.
~/.config/dotfiles/scripts/.local/bin/dot init --noninteractive --confirm

# Ongoing workflow after restarting the shell
dot update
dot git-diff
dot doctor
```

## Command reference

- `dot init` - one-time first-use setup for fresh machines: private dotfiles bootstrap when `gh auth` is available, Omarchy sync, early Hypr host-link setup (`--host <name>`, default `OMARCHY_HOST` or `desktop`), install/adopt, stowed mise tool install, package setup, machine hooks, agents sync, then `dot update`; logs to `/tmp/dot-init.log` by default or `--log <path>`; fails fast after successful init
- `dot install` - ensure prerequisites, then run the backup/adopt install flow for public/private dotfiles
- `dot update` - self-update public dotfiles first, install dependencies, rebuild and restart on the rebuilt binary, then run Omarchy + public/private pull (including configured private git repos), stow refresh, Hypr host-link setup, and first-use completion marker backfill for already-setup machines
- `dot stow` - stow refresh only (no git pull)
- `dot doctor` - tool, repo, workflow runs, private git repo, remote, public/private package, private package repo, and Chromium extension health checks
- `dot clean` - unstow private then public
- `dot git-diff` - git status + staged/unstaged summaries with fetched unpushed/incoming commit checks across managed repos (including private git repos with `activity.enabled: true` and Omarchy repos); use `dot git-diff --bar-json` for one-line status bar JSON (`dot diff` remains a human compatibility alias)
- `dot git-log` - recent commits across the same tracked repos as `dot git-diff`, sorted by latest commit activity; use `--raw` for CLI text output
- `dot git-workflows` - two-pane watched GitHub workflow runs view for each repo's locally checked-out HEAD commit; use `--since <date>` to filter by activity time, and `--raw`, `--bar-json`, `--list-repos`, or `--list-runs` for CLI output
- `dot git-notifications` - GitHub notification inbox with open, mark-read, done, ignore, unignore, and bot-read actions; use `--all`, `--participating`, `--since <date>`, `--bar-filter`, `--raw`, `--bar-json`, `--list-threads`, `--mark-read <id>`, `--mark-bot-read`, `--dry-run`, `--mark-done <id>`, `--ignore <id>`, or `--unignore <id>` for CLI output/actions
- `dot notes` - two-pane repository notes browser; use `--all` or press `g` to browse every repo notes directory, and `dot notes list --all` for CLI output grouped by repo
- `dot handoffs` / `dot handoff` - open the notes browser filtered to notes tagged `handoff`; use `--all` to browse handoffs across every repo
- `dot agents-sync` - copy `~/.config/opencode/AGENTS.md` into `agents/.cursor/rules/global-agents.mdc` in private dotfiles by default (`alwaysApply: true` + body; stows to `~/.cursor/rules/`). **`dot update`** and **`dot git-diff`** run this automatically by default (see env vars below).
- `dot opencode-debug [--agent <name>]` - run `opencode debug paths`, `config`, `skill`, and `info` together; optionally inspect one agent with `opencode debug agent <name>`
- `dot setup-private-repo` - sync the private Arch package repo mirror and repair the pacman include snippet
- `dot private-pkg-publish [--no-git] [--skip-build] [--install] <package>` - build and publish a mapped private package into the private pacman repo, sync the mirror, refresh pacman metadata, optionally install it, and commit/push by default
- `dot skill-updates` - check or apply upstream updates for imported skills
- `dot skill-check` - validate skill references across AGENTS and agent files
- `dot omarchy` - open the Omarchy desktop controls menu
- `dot help` - show the CLI help menu

## OpenCode

OpenCode agents, commands, and plugins live in `agents/.config/opencode/`; shared skills live in `agents/.agents/skills/`. They are automatically published together to [`timmo001/opencode-config`](https://github.com/timmo001/opencode-config) so they can be browsed, imported, and installed independently of the full dotfiles repo — see that repo for documentation and installation instructions.

- Debug: `dot opencode-debug [--agent <name>]`
- Publishing is automatic via GitHub Actions on push

## System health check

- `system-health-check` - friendly multi-snapshot system health report for CPU, memory, network, pressure, and known logs
- Add `--open-opencode` to run `opencode run` against the saved report, then open a full interactive OpenCode session with `opencode --continue`

## GitHub Workflow Runs And Notifications

- Private dotfiles provide repo activity, workflow, and GitHub notification config in `~/.config/dotfiles-private/dot-git.yml`
- `dot git-workflows` shows watched repos on the left, with workflow runs for the selected locally checked-out HEAD commit on the right; disabled workflows are hidden; `dot git-workflows --bar-json --since "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)"` emits one-line status bar JSON for runs created, rerun, or updated in the window, and `--list-repos`/`--list-runs` emit plain text rows
- The Waybar workflow module refreshes `dot git-workflows --bar-json --since <one-hour-ago>` through its own short-lived cache; left click opens the filtered TUI and right click refreshes the cache
- `git-workflow-watch`, its global hook, and its user systemd timer are obsolete and should not be installed
- `dot doctor` verifies `dot-git.yml`, active Waybar workflow-runs module wiring, and absence of legacy `git-workflow-watch` leftovers
- `dot git-notifications` shows the authenticated user's GitHub notification inbox; the API requires `gh` authenticated with a classic token carrying `notifications` or `repo` scope
- `dot git-notifications --mark-bot-read` marks unread bot notifications, such as Renovate and Dependabot pull requests, as read; use `--dry-run` first to preview the matched threads
- The Waybar notification module refreshes `dot git-notifications --bar-json` through its own short-lived cache; notification surfaces hide repos that are not enabled in `dot-git.yml`, while upstream notifications can match a managed fork's `remote.upstream.url`; left click opens `dot git-notifications --bar-filter` and right click refreshes the cache
- `dot doctor` verifies GitHub notification API access plus the active Waybar notification module wiring

## Daily volume reset

- Public dotfiles provide `daily-volume-zero.timer` in laptop-only stow packages (`scripts--laptop` and `systemd--laptop`), a user systemd timer that runs at 5am local time
- The timer runs `daily-volume-zero`, which sends a 10-second desktop notification, clears default sink mute, then sets the default PipeWire/WirePlumber sink volume to `0%`
- The timer is optional and is not enabled by `dot`; use `systemctl --user enable --now daily-volume-zero.timer` on machines that should use it

## Environment options

- `DOTFILES_PUBLIC_DIR` - public dotfiles path (default `~/.config/dotfiles`)
- `DOTFILES_PRIVATE_DIR` - private dotfiles path (default `~/.config/dotfiles-private`)
- `DOT_ALLOW_PRIVATE` - `auto|always|never` (default `auto`)
- `DOT_PRIVATE_GH_USER` - expected GitHub user for private actions (default `timmo001`)
- `DOT_GIT_CONFIG_FILE` - private git repo config file for `dot git-diff`, `dot git-log`, `dot git-workflows`, `dot git-notifications --bar-json`, `dot update`, and `dot doctor` (default `$DOTFILES_PRIVATE_DIR/dot-git.yml`; each repo has required `activity`, `workflows`, and `notifications` checks with explicit `enabled` and 5-field cron `schedule` keys, plus `notifications.bar.ignore_bot_activity` for status-bar noise control)
- `DOT_PRIVATE_PACKAGE_REPO_FILE` - private pacman repo config for `dot` (default `$DOTFILES_PRIVATE_DIR/.dot-private-package-repo`)
- `DOT_PRIVATE_PACKAGES_FILE` - private package list for `dot` (default `$DOTFILES_PRIVATE_DIR/.dot-private-packages`)
- `DOT_PRIVATE_PACMAN_REPO_CONFIG` - pacman repo snippet path written by `dot` (default `/etc/pacman.d/timmo-private.conf`)
- `OMARCHY_REPO_BASE_DIR` - Omarchy repo base path (default `~/.config`)
- `OMARCHY_HOST` - Hypr host override name used for host-specific packages and `~/.config/hypr/host`; `dot init` defaults to `desktop` when this is unset unless `--host <name>` is passed
- `DOT_OMARCHY_BRANCH` - branch override for non-bootstrap Omarchy repos during sync
- `DOT_BOOTSTRAP_BRANCH` - branch for `bootstrap` sync (default `distro/omarchy`)
- `DOT_INCLUDE_OMARCHY_DIFF_REPOS` - include Omarchy repos in `dot git-diff` (`1|0`, default `1`)
- `DOT_INCLUDE_OMARCHY_UPDATE_REPOS` - include Omarchy repos in `dot update` sync (`1|0`, default `1`)
- `DOT_INIT_NONINTERACTIVE` - force non-interactive init mode (`1|0`, default `0`)
- `DOT_INIT_LOG_FILE` - default `dot init` log path when `--log` is not passed (default `/tmp/dot-init.log`)
- `DOT_DAILY_VOLUME_ZERO_TIMER_UNIT` - 5am volume reset timer unit name (default `daily-volume-zero.timer`)
- `DOT_AUTO_CD` - zsh wrapper auto-cd to first repo with changes after `dot git-diff`; otherwise restore original dir (failed diff falls back to `~/.config/dotfiles`) (`1|0`, default `1`)
- `DOT_AGENTS_SYNC_SOURCE` - AGENTS file to mirror (default `~/.config/opencode/AGENTS.md`)
- `DOT_AGENTS_SYNC_RULE_FILE` - Cursor rule output path (default `$DOTFILES_PRIVATE_DIR/agents/.cursor/rules/global-agents.mdc`, else `~/.cursor/rules/global-agents.mdc`)
- `DOT_AGENTS_SYNC_ON_UPDATE` - run `agents-sync` after `dot update` (`1|0`, default `1`)
- `NOTES` - notes vault git repo used by `dot notes` and OpenCode note commands (preferred; default `~/Documents/notes`)
- `DOT_NOTES_DIR` - compatibility notes vault override used when `NOTES` is unset
- `DOT_FETCH_TTL_SECONDS` - seconds to reuse last upstream fetch (default `300`)

## New machine checklist

1. Clone `dotfiles` to `~/.config/dotfiles`
1. If private dotfiles are wanted, confirm `gh auth status` works before `dot init`; init clones `dotfiles-private` to `~/.config/dotfiles-private` automatically when auth is available
1. Install bootstrap build prerequisites: `sudo pacman -S --needed git mise`
1. Run `cd ~/.config/dotfiles/dot && mise --no-config exec bun@latest -- bun install && mise --no-config exec bun@latest -- bun run build`
1. Run `~/.config/dotfiles/scripts/.local/bin/dot init --noninteractive --confirm` for desktop/VM setup, `dot init --host laptop --noninteractive --confirm` for laptop setup, or `dot init` in an interactive shell
1. If stock Omarchy config directories already exist at `~/.config/hypr`, `~/.config/waybar`, `~/.config/ghostty`, or `~/.config/uwsm`, `dot init` backs them up with a `.dot-init-backup-*` suffix before cloning the managed repos
1. Restart shell and confirm `dot help` is on `PATH`
1. Run `dot git-diff` and verify expected repo state
1. Run `dot update` for ongoing sync, stow, rebuild, and init-state backfill

`dot init` creates `~/.config/hypr/host` immediately after syncing Omarchy repos and before stow/package setup. It then runs `mise install` immediately after stowing dotfiles and before installing managed Arch/AUR package lists, so Bun, Node, pnpm, and similar developer tools should come from the stowed mise config rather than global pacman packages.

For GNOME Boxes shared folders, Arch provides `spice-webdavd` in the `phodav` package. Share a host folder from Boxes and pass `--log <shared-path>/dot-init.log` when you want init output written somewhere visible from the host.
