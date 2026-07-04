---
title: Command Reference
description: Every dot command, alias, flag and example, generated from the CLI registry.
sidebar:
  order: 2
---

<!-- Generated from dot/src/cli/spec.ts by `mise run docs:gen:cli`. Do not edit by hand. -->

This page lists every `dot` command, generated from the same registry that powers `dot help` and shell completions. Run any command with `--help` to see the same details at the terminal.

## `dot dashboard`

Open the dot dashboard

```text
dot dashboard [options]
```

Open the full-screen dot dashboard. It combines tracked repo
state, GitHub notifications, workflow runs, and optional bounded source
commands for Twitch, environment, and calendar cards.

**Modes**

```text
(default)      Interactive dashboard
```

**Examples**

```bash
dot dashboard
```

## `dot init`

Run one-time first-use machine setup

```text
dot init [options]
```

Run the one-time first-use setup workflow for a fresh machine. Init prepares
repos, stow links, mise tools, packages, and machine hooks. After init
completes, reboot so the Omarchy session picks up host env, then run
dot doctor. Before the bounded workflow starts, init updates or clones the
optional private overlay according to DOT_ALLOW_PRIVATE. Use dot update for
ongoing maintenance.

**Options**

| Option | Description |
| --- | --- |
| `--confirm` | Compatibility flag; accepted but does not suppress prompts |
| `--noninteractive` | Skip the Hypr host questionnaire for this run |
| `--interactive` | Enable the Hypr host questionnaire when no host is selected |
| `--force` | Re-run init even if the machine looks initialised |
| `--host` `<name>` | Hypr host to link before stow (default: OMARCHY_HOST or desktop) |
| `--log` `<path>` | Init log path (default: ~/.local/state/dot/init.log) |
| `--branch` `<name>` | Branch override for Omarchy repos |

**Examples**

```bash
dot init --noninteractive
dot init --host laptop --noninteractive
dot init --force --noninteractive
dot init --branch main
```

## `dot install`

Ensure prerequisites, then backup/adopt dotfiles

```text
dot install
```

## `dot update`

Aliases: `dot up`

Self-update, pull repos, stow dotfiles, rebuild

```text
dot update
```

A full update pulls the public dotfiles, installs Bun dependencies, rebuilds
and relaunches dot, then scans and pulls tracked repositories. It trusts
tracked mise configs, regenerates completions, installs missing public
Arch/AUR packages, runs the required MCP sync, stows, rebuilds again, runs
agents sync, backfills the init marker, and starts the resume refresh.

Phase flags are inclusive: passing any of --pull, --stow, or --app runs only
the selected phases. Scoped runs skip full-update package reconciliation,
agents sync, and init-marker backfill. Every mode that reaches the end starts
the bounded resume refresh.

**Options**

| Option | Description |
| --- | --- |
| `--pull` | Run the repository pull phase only |
| `--stow` | Generate completions, sync MCP configs, and stow only |
| `--app` | Install Bun dependencies and rebuild the dot binary only |
| `--check` | Report core/system repos behind upstream (no update); exit 10 if any |
| `--check-all` | Report all tracked repos behind upstream (no update); exit 10 if any |

**Exit codes**

```text
0   Update completed, or an update check found nothing behind
1   Fatal workflow failure
2   Update check could not scan repositories
10  Update check found repositories behind upstream
11  Legacy Hypr migration is required before update can continue
```

## `dot stow`

Re-stow public/private dotfiles

```text
dot stow
```

**Options**

| Option | Description |
| --- | --- |
| `--public` | Stow public dotfiles only |
| `--private` | Stow private dotfiles only |

## `dot firewall`

Reconcile managed ufw firewall rules

```text
dot firewall
```

Ensure the managed ufw allow rules are present with their exact source,
destination, interface/direction, and purpose comment. Missing rules are
added, stale-comment rules are deleted and re-added, then ufw is reloaded
once. A source-restricted rule does not satisfy a managed any-source rule.

**Examples**

```bash
dot firewall
```

## `dot doctor`

Run dotfiles system health checks

```text
dot doctor [options]
```

Run health checks on the dotfiles system. Verifies dependencies, repos,
stow integrity, systemd timers, packages, browser config, and more.

All checks run in parallel and each section streams to the terminal as it
finishes, so sections appear in completion order. A grouped summary of any
errors and warnings, ordered by section, follows at the end. A log file is
always written to ~/.local/state/dot/logs/.

**Options**

| Option | Description |
| --- | --- |
| `--open-opencode` | Save the report and attempt to open it in OpenCode |

**Checks performed**

```text
Dependencies         Required/optional CLI tools (git, stow, gh, gum, ...)
gh extensions        Configured gh CLI extensions are installed
Locale               Required locales from shell config are generated
Zsh key bindings     Delete/forward-delete bindings and other expected defaults
Repositories         Public/private dotfiles + private git repos exist and have upstreams
Origin HEAD          Local origin/HEAD tracks the remote default branch (not stale)
Stow integrity       Dry-run restow to detect drift
OpenCode location    Canonical paths, legacy remnants
OpenCode server      Shared Hypr autostart and ~/.config/opencode/.env password
Herdr integration    Herdr binary and OpenCode integration installed
GitHub MCP auth      gh token available for DOT_GH_MCP_BEARER
Git config           Managed include is active
Workflow runs        Repo list and legacy watcher cleanup
Git notifications    API scope and notification access
Doctor startup       Startup notification timer
uwsm session PATH    ~/.local/bin on the uwsm/systemd user-environment PATH
Daily volume reset   Laptop-only optional timer
Omarchy repos        Diff repos + worktree branch correctness
Legacy Hypr repo     Flags a retired omarchy-hypr clone at ~/.config/hypr
Neovim theme link    Repairs a mislocated omarchy-nvim theme.lua symlink
Private access       Private dotfiles overlay enabled or explains why it is disabled
Browser flags        Symlinks from private stow package
Hardware video       VAAPI render nodes, drivers, packages
Browser extensions   Private extension check list
Public packages      AUR packages installed + version check
Private package repo Private pacman repo registered
Private packages     Private repo + packages installed
Pacman hooks         Hook files installed and up to date
Firewall rules       Managed ufw rules (KDE Connect, Home Assistant, OpenCode, LocalSend, libvirt); repair with dot firewall
```

**Exit codes**

```text
0    No critical errors (warnings may still be present)
1    One or more critical errors found
```

**Examples**

```bash
dot doctor
dot doctor --open-opencode
```

## `dot clean`

Unstow managed dotfiles

```text
dot clean
```

## `dot git-diff`

Aliases: `dot diff`

Open the git diff/repo watcher view

```text
dot git-diff [options]
```

Open the diff/repo watcher view. Without flags, opens the interactive TUI.

**Modes**

```text
(default)        Interactive TUI diff view
--raw            Text summary of repos with changes
--bar-json      JSON output for status bars and shell modules
--list-changed   Changed repos as name|path rows
--list-all       All tracked repos as name|path rows
```

**Options**

| Option | Description |
| --- | --- |
| `--no-fetch` | Skip fetching from remotes (use local refs only) |
| `--tab` `<tab>` | Initial pane to focus in TUI (default: changed) (one of: `changed`, `other`, `unchanged`) |
| `--raw` | Text summary output |
| `--bar-json` | JSON output for status bars and shell modules |
| `--list-changed` | Changed repos as rows |
| `--list-all` | All tracked repos as rows |

**Examples**

```bash
dot git-diff
dot git-diff --raw
dot git-diff --bar-json
dot git-diff --tab other
```

## `dot git-commit`

Commit staged changes through the guarded gateway

```text
dot git-commit --message <subject> [options] | --amend [options]
```

Create a commit through dot's guarded gateway instead of raw git commit.
The subject is validated as a single line with no trailing full stop and
a length limit, then the staged set (or an explicit --path scope) is
committed. It never runs git add -A.

Pass --amend to rewrite the previous commit instead of creating a new
one; it keeps the existing message unless you pass --message. With
--push, an amend force-pushes with --force-with-lease (never a plain
force).

Agents are routed here by the git-commit skill and blocked from raw
git commit in the OpenCode permission config, so commits stay in the
maintainer's concise one-line style.

**Modes**

```text
(default)     Commit the staged set
--path        Commit only the named files
--amend       Rewrite the previous commit
--dry-run     Preview the plan, change nothing
```

**Options**

| Option | Description |
| --- | --- |
| `--message` `-m` `<subject>` | Single-line commit subject (required unless --amend) |
| `--path` `<file>` | Commit only this file; repeatable |
| `--amend` | Amend the previous commit; keeps its message unless --message is given |
| `--push` | Push the current branch after committing (pulls --rebase first, or force-with-lease when amending, never a plain force) |
| `--dry-run` | Preview the commit and push plan without changing anything |

**Message guards**

```text
Single line     Rejects multi-line messages
No em/en-dash   Rejects '—' and '–'; use a hyphen
No full stop    Rejects a trailing '.'
Warn over 60    Warns on stderr, still commits
Reject over 120 Fails; shorten the subject
```

**Base branch guard**

```text
Refuses commits to the base branch of a repo you do not own,
including a fork kept for upstream PRs. Owners you control are
listed in `git config dot.owner`. Work on a feature branch.
```

**Examples**

```bash
dot git-commit -m "Add commit gateway"
dot git-commit -m "Scope to one file" --path src/git/commands/Status.ts
dot git-commit -m "Commit and push" --push
dot git-commit --amend
dot git-commit --amend -m "Reword the previous commit"
dot git-commit -m "Preview only" --dry-run
```

## `dot git-log`

Open recent commits across tracked repos

```text
dot git-log [options]
```

Open the recent commit history view. The left pane lists tracked repositories
from dot git-diff, sorted by latest commit activity. The right pane lists recent
commits for the selected repository.

**Modes**

```text
(default)      Interactive git log TUI
--raw          Text summary of recent commits
```

**Options**

| Option | Description |
| --- | --- |
| `--raw` | Text summary of recent commits |

**Examples**

```bash
dot git-log
dot git-log --raw
```

## `dot git-workflows`

Open watched GitHub workflow runs

```text
dot git-workflows [options]
```

Open the watched GitHub workflow runs view. The left pane lists watched
repositories from the private repo list. The right pane lists runs for the
selected repo's locally checked-out HEAD commit.

**Modes**

```text
(default)      Interactive workflow runs TUI
--raw          Text summary of watched workflow runs
--bar-json    JSON output for status bars and shell modules
--list-repos   Watched repo summaries as rows
--list-runs    Workflow runs as rows
```

**Options**

| Option | Description |
| --- | --- |
| `--since` `<date>` | Only include runs active at or after this date (ISO/RFC/epoch/relative duration) |
| `--raw` | Text summary of watched workflow runs |
| `--bar-json` | JSON output for status bars and shell modules |
| `--list-repos` | Watched repo summaries as rows |
| `--list-runs` | Workflow runs as rows |

**Examples**

```bash
dot git-workflows
dot git-workflows --raw
dot git-workflows --bar-json
dot git-workflows --since "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)"
dot git-workflows --list-runs
```

## `dot git-notifications`

Open GitHub notification inbox

```text
dot git-notifications [options]
```

Open the authenticated user's GitHub notification inbox. Without machine or
action flags, opens the interactive TUI.

**Modes**

```text
(default)       Interactive notifications TUI
--raw           Text summary of notification threads
--bar-json     JSON output for status bars and shell modules
--list-threads  Notification threads as rows
--bar-filter    Apply watched-repo filtering in raw/list output
```

**Options**

| Option | Description |
| --- | --- |
| `--raw` | Text summary of notification threads |
| `--bar-json` | JSON output for status bars and shell modules |
| `--list-threads` | Notification threads as rows |
| `--bar-filter` | Apply watched-repo filtering in raw/list output |
| `--all` | Include read notifications |
| `--participating` | Only include participating or mentioned threads |
| `--since` `<date>` | Only include notifications updated after this date |
| `--mark-read` `<id>` | Mark a notification thread as read |
| `--mark-bot-read` | Mark unread Renovate/Dependabot/bot notifications as read |
| `--dry-run` | Preview --mark-bot-read without mutating GitHub state |
| `--mark-done` `<id>` | Mark a notification thread as done |
| `--ignore` `<id>` | Ignore new notifications for a thread |
| `--unignore` `<id>` | Stop ignoring notifications for a thread |

**Examples**

```bash
dot git-notifications
dot git-notifications --bar-json
dot git-notifications --participating
dot git-notifications --mark-bot-read --dry-run
dot git-notifications --mark-read 12345
```

## `dot agents-sync`

Mirror AGENTS.md to agent harness instruction files

```text
dot agents-sync
```

## `dot mcp-sync`

Regenerate MCP configs for all harnesses from the spec

```text
dot mcp-sync
```

Regenerate each active harness's native MCP config from the single
private spec (mcp.yml), keeping agent harness MCP configs aligned.
Writes into the stowed private source tree; run dot stow after.

Some agent harnesses are documented stubs and are not written.
OpenCode gated servers also receive a default-off tools gate so their
tool schemas stay out of the baseline context until an agent re-enables
them.

**Examples**

```bash
dot mcp-sync
```

## `dot notes-capture-sync`

Sync watched repositories to the notes capture picker

```text
dot notes-capture-sync
```

Regenerate the notes capture repository picker from repositories with
GitHub notifications enabled in the private dot-git.yml configuration.
Updates only CAPTURE_REPOSITORIES in the ignored
capture/wrangler.local.jsonc file, creating it from the deploy template
when needed. Mirrors non-secret settings from the active Worker, then
deploys when the live picker differs.

**Examples**

```bash
dot notes-capture-sync
```

## `dot is-agent`

Detect whether an AI coding agent is running dot

```text
dot is-agent [options]
```

Detect whether dot is running under an agent harness from agent
environment variables, falling back to a Linux
/proc process-ancestry check. Exits 0 when an agent is detected and 1
otherwise, so scripts can branch with `if dot is-agent`.

Set DOT_AGENT=1 to force detection on or DOT_AGENT=0 to force it off.

**Modes**

```text
(default)   Print the detected agent, or a no-agent message
--quiet     Print only the provider id (nothing when no agent)
--json      Print the detection result as JSON
```

**Options**

| Option | Description |
| --- | --- |
| `--quiet` `-q` | Print only the provider id |
| `--json` | Print the detection result as JSON |

**Examples**

```bash
dot is-agent
dot is-agent --quiet
dot is-agent --json
dot is-agent && echo running under an agent
```

## `dot setup-public-repo`

Trust and register the public timmo pacman repository

```text
dot setup-public-repo
```

Download the public signing key, require its pinned full fingerprint,
locally sign it in pacman's keyring, and register the signed [timmo]
repository before the other package repositories.

The command fails before changing trust or pacman configuration when the
repository is unavailable or the downloaded fingerprint does not match.

**Examples**

```bash
dot setup-public-repo
```

## `dot setup-private-repo`

Sync and register the private pacman repository

```text
dot setup-private-repo
```

Sync the private Arch package repo mirror, write the private pacman repo
snippet, and add the Include line to /etc/pacman.conf when it is missing.

This repairs Omarchy pacman.conf refreshes that remove local repository
includes. Privileged writes prefer pkexec and fall back to sudo.

**Examples**

```bash
dot setup-private-repo
```

## `dot private-pkg-publish`

Build and publish a private package

```text
dot private-pkg-publish [options] <package-name>
```

Build and publish a mapped private package into the private pacman repo.

**Options**

| Option | Description |
| --- | --- |
| `--no-git` | Skip package repo commit and push |
| `--skip-build` | Publish an existing dist package artifact |
| `--install` | Install the published package after syncing the mirror |

**Arguments**

| Argument | Description |
| --- | --- |
| `<package-name>` |  |

**Examples**

```bash
dot private-pkg-publish twitch-notifications --install
dot private-pkg-publish --skip-build --no-git twitch-notifications
```

## `dot skill-updates`

Check/apply imported skill updates

```text
dot skill-updates
```

**Options**

| Option | Description |
| --- | --- |
| `--check` | Check only without applying |
| `--update` | Auto-apply clean updates |
| `--json` | Report update states as JSON without applying |
| `--skill` `<name>` | Limit checking or updating to one imported skill |
| `--no-commit` | Apply updates without creating a commit |
| `--skip-review` | Skip local-edit review |

**Examples**

```bash
dot skill-updates --json
dot skill-updates --update --skill browser-control --no-commit
```

## `dot skill-check`

Validate skill maintenance wiring

```text
dot skill-check
```

**Options**

| Option | Description |
| --- | --- |
| `--open-opencode` | Run checks and attempt OpenCode analysis |
| `--diff-origin` | Diff imported skills against their upstream origins; with --open-opencode, include the diff in the prompt |

## `dot completions`

Generate shell completions

```text
dot completions [bash|fish|zsh] [--stdout]
```

Generate shell completions for dot.

By default this writes the managed completion file for the selected shell
in the public dotfiles repo so the next dot stow installs it.

**Options**

| Option | Description |
| --- | --- |
| `--stdout` | Print the completion script instead of writing it |

**Arguments**

| Argument | Description |
| --- | --- |
| `<shell>` | One of: `bash`, `fish`, `zsh`. |

**Examples**

```bash
dot completions zsh
dot completions bash --stdout
dot completions fish --stdout
```

## `dot omarchy`

Open an Omarchy submenu by path

```text
dot omarchy [submenu...]
```

Open the Omarchy desktop controls menu. Pass a submenu path to jump straight
to it:

  dot omarchy theme        Theme submenu
  dot omarchy theme set    Execute theme set directly

**Arguments**

| Argument | Description |
| --- | --- |
| `<submenu>` | Repeatable. One of: `theme`, `font`, `toggle`, `capture`, `system`, `launch`, `refresh`, `restart`, `install`, `remove`, `packages`, `share`, `reminder`, `setup`, `snapshot`, `brightness`, `power`. |

**Available submenus**

```text
theme       Theme management
font        Font management
toggle      Toggle system features
capture     Screenshots and recordings
system      Lock, logout, reboot, shutdown
launch      Launch applications
refresh     Refresh system components
restart     Restart system services
install     Install software and tools
remove      Remove software and features
packages    Package management
share       Share clipboard, files, folders
reminder    Reminders
setup       DNS, security setup
snapshot    System snapshots
brightness  Display and keyboard brightness
power       Power profiles
```

## `dot usage`

Local-first analytics for dot usage

```text
dot usage [summary|stale|path|backfill] [options]
```

Report local-first usage analytics for dot. Dispatched dot commands append
NDJSON events under $XDG_STATE_HOME/tool-usage with timestamps, machine,
canonical command, recognised flag names, exit status, duration, source,
and invoker. Live dot events never store positional values.

Optional shell-history backfill observes selected standalone tools without
requiring integration. It uses whitespace tokenisation, so review the source
history before applying when arguments may contain sensitive text.

Set DOT_USAGE_DISABLE=1 to stop automatic live recording, or DOT_USAGE_DIR
to relocate the event root. Explicit backfill --apply still writes events.

**Modes**

```text
summary    Per-feature usage table (default)
stale      Features not used within the window
path       Print the event storage root
backfill   Import whitelisted invocations from shell history
```

**Options**

| Option | Description |
| --- | --- |
| `--days` `<n>` | Window for summary/stale (default: 90) |
| `--format` `<fmt>` | summary format (one of: `text`, `json`, `agent-context`) |
| `--root` `<path>` | Extra event root to combine (repeatable) |
| `--history` | Backfill from shell history (accepted for clarity) |
| `--apply` | Write events during backfill (default: dry run) |

**Examples**

```bash
dot usage summary --days 30
dot usage summary --format agent-context
dot usage stale --days 90
dot usage backfill --history
dot usage backfill --history --apply
```

## `dot help`

Show this help menu

```text
dot help
```
