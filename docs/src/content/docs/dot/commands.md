---
title: Command Reference
description: Every dot command, alias, flag and example, generated from the CLI registry.
---

<!-- Generated from dot/src/cli/spec.ts by `bun run gen:cli`. Do not edit by hand. -->

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
repos, stow links, mise tools, packages, machine hooks, and then finishes by
running dot update. After init completes, use dot update for ongoing maintenance.

**Options**

| Option | Description |
| --- | --- |
| `--confirm` | Acknowledge non-interactive package helpers |
| `--noninteractive` | Skip interactive prompts for this run |
| `--interactive` | Allow interactive prompts for this run |
| `--force` | Re-run init even if the machine looks initialised |
| `--host` `<name>` | Hypr host to link before stow (default: OMARCHY_HOST or desktop) (one of: `desktop`, `laptop`) |
| `--log` `<path>` | Init log path (default: /tmp/dot-init.log) |
| `--branch` `<name>` | Branch override for non-bootstrap Omarchy repos |
| `--bootstrap-branch` `<name>` | Branch override for bootstrap |

**Examples**

```bash
dot init --noninteractive --confirm
dot init --host laptop --noninteractive --confirm
dot init --force --noninteractive --confirm
dot init --branch main --bootstrap-branch distro/omarchy
```

## `dot install`

Ensure prerequisites, then backup/adopt dotfiles

```text
dot install
```

## `dot update`

Aliases: `dot up`

Pull repos, stow dotfiles, install deps, rebuild

```text
dot update
```

**Options**

| Option | Description |
| --- | --- |
| `--pull` | Pull repos only |
| `--stow` | Stow only |
| `--tui` | Install deps and rebuild dot binary only |
| `--check` | Report core/system repos behind upstream (no update); exit 10 if any |
| `--check-all` | Report all tracked repos behind upstream (no update); exit 10 if any |

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

## `dot doctor`

Run dotfiles system health checks

```text
dot doctor [options]
```

Run health checks on the dotfiles system. Verifies dependencies, repos,
stow integrity, systemd timers, packages, browser config, and more.

All checks run in parallel. Results are printed per-section with a grouped
summary at the end. A log file is always written to ~/.local/state/dot/logs/.

**Options**

| Option | Description |
| --- | --- |
| `--open-opencode` | Save report and open it in OpenCode |

**Checks performed**

```text
Dependencies         Required/optional CLI tools (git, stow, gh, gum, ...)
gh extensions        Configured gh CLI extensions are installed
Repositories         Public/private dotfiles + private git repos exist and have upstreams
Origin HEAD          Local origin/HEAD tracks the remote default branch (not stale)
Stow integrity       Dry-run restow to detect drift
OpenCode location    Canonical paths, legacy remnants
Git config           Managed include is active
Workflow runs        Repo list, status bar config, legacy watcher cleanup
Git notifications    API scope and status bar notification module wiring
Doctor startup       Startup notification timer
Daily volume reset   Laptop-only optional timer
Omarchy repos        Diff repos + worktree branch correctness
Legacy Hypr repo     Flags a retired omarchy-hypr clone at ~/.config/hypr
Neovim theme link    Repairs a mislocated omarchy-nvim theme.lua symlink
Browser flags        Symlinks from private stow package
Hardware video       VAAPI render nodes, drivers, packages
Browser extensions   Private extension check list
Public packages      AUR packages installed + version check
Private packages     Private repo + packages installed
Pacman hooks         Hook files installed and up to date
Firewall rules       Managed ufw ports (KDE Connect, Home Assistant, OpenCode)
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

## `dot git-status`

Show branch status for the current repository

```text
dot git-status [options]
```

Print unstaged files, staged files, and the last 10 commits — each with a
compact relative timestamp, a pushed/local remote marker, and its changed
files inline with (+added -deleted) line counts — for the current git
repository. Designed as a single command for agents to get full
working-tree and branch context.

Substitutes running these separately: git status, git diff --stat /
git diff --numstat, git diff --cached --stat, git log --oneline --stat,
and git log @{upstream}..HEAD (ahead/pushed check).

Add --diff to append the full unstaged and staged diffs under their
sections, and --branch-diff to append the full diff of the current branch
against the default branch (measured from their merge base so committed
and uncommitted changes both show). --branch-diff errors on the default
branch, where that range is empty. The flags combine.

**Modes**

```text
(default)       Status summary: unstaged, staged, recent commits
--diff          Also print full unstaged and staged diffs
--branch-diff   Also print the full diff vs the default branch
```

**Options**

| Option | Description |
| --- | --- |
| `--diff` | Append full unstaged and staged diffs for changed files |
| `--branch-diff` | Append the merge-base diff vs the default branch (errors on the default branch) |

**Examples**

```bash
dot git-status
dot git-status --diff
dot git-status --branch-diff
dot git-status --diff --branch-diff
```

## `dot git-commit`

Commit staged changes through the guarded gateway

```text
dot git-commit --message <subject> [options]
```

Create a commit through dot's guarded gateway instead of raw git commit.
The subject is validated as a single line with no trailing full stop and
a length limit, then the staged set (or an explicit --path scope) is
committed. It never runs git add -A.

Agents are routed here by the git-commit skill and blocked from raw
git commit in the OpenCode permission config, so commits stay in the
maintainer's concise one-line style.

**Modes**

```text
(default)     Commit the staged set
--path        Commit only the named files
--dry-run     Preview the plan, change nothing
```

**Options**

| Option | Description |
| --- | --- |
| `--message` `-m` `<subject>` | Single-line commit subject (required) |
| `--path` `<file>` | Commit only this file; repeatable |
| `--push` | Push the current branch after committing (never forces) |
| `--dry-run` | Preview the commit and push plan without changing anything |

**Message guards**

```text
Single line     Rejects multi-line messages
No em/en-dash   Rejects '—' and '–'; use a hyphen
No full stop    Rejects a trailing '.'
Warn over 60    Warns on stderr, still commits
Reject over 120 Fails; shorten the subject
```

**Branch guard**

```text
Refuses commits to a repo's default branch on repos you do not
own (owners in `git config dot.owner`). Add more protected
branches with `git config --add dot.protectedBranch <name>`.
```

**Examples**

```bash
dot git-commit -m "Add commit gateway"
dot git-commit -m "Scope to one file" --path src/git/commands/Status.ts
dot git-commit -m "Commit and push" --push
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
| `--since` `<date>` | Only include runs active at or after this date (ISO/RFC/epoch) |
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
| `--ignore` `<id>` | Ignore future notifications for a thread |
| `--unignore` `<id>` | Stop ignoring future notifications for a thread |

**Examples**

```bash
dot git-notifications
dot git-notifications --bar-json
dot git-notifications --participating
dot git-notifications --mark-bot-read --dry-run
dot git-notifications --mark-read 12345
```

## `dot notes`

Open repository notes or run note utility commands

```text
dot notes [--all] [command] [options]
```

Manage repository notes used by OpenCode note commands.

**Modes**

```text
(default)                    Interactive notes TUI
--all                        Interactive notes TUI across all repos
```

**Options**

| Option | Description |
| --- | --- |
| `--all` | Show notes from every repo-notes directory |

**Examples**

```bash
dot notes
dot notes --all
dot notes root
dot notes context --command notes-list
dot notes list --all
dot notes list --format json
```

### `dot notes root`

Print the notes vault root

```text
dot notes root
```

**Options**

| Option | Description |
| --- | --- |
| `--repo-notes` | Print repository notes directory |

### `dot notes context`

Print the context block for OpenCode notes

```text
dot notes context
```

**Options**

| Option | Description |
| --- | --- |
| `--command` `<name>` | OpenCode command name |

### `dot notes list`

List repository notes

```text
dot notes list
```

**Options**

| Option | Description |
| --- | --- |
| `--all` | Show notes from every repo-notes directory |
| `--format` `<labels|json>` | Output format (one of: `labels`, `json`) |

## `dot handoffs`

Aliases: `dot handoff`

Open handoff notes

```text
dot handoffs [--all] [--list]
```

Open the interactive notes TUI filtered to notes tagged handoff.
Use --list for a plain text listing without the TUI.

**Options**

| Option | Description |
| --- | --- |
| `--all` | Show handoff notes from every repo-notes directory |
| `--list` | List handoff notes to stdout without opening the TUI |

**Aliases**

```text
dot handoff
dot handoffs
```

## `dot note`

Read, write, or delete note files

```text
dot note <command> [options]
```

Read, write, and delete note files. Writes and deletes are committed to the
notes vault when possible.

**Examples**

```bash
dot note read --path ~/Documents/notes/repo-notes/owner/repo/topic.md
dot note write --path /tmp/notes/repo-notes/owner/repo/topic.md --stdin
dot note delete --path /tmp/notes/repo-notes/owner/repo/topic.md
```

### `dot note read`

Print a note file

```text
dot note read
```

**Options**

| Option | Description |
| --- | --- |
| `--path` `<path>` | Note file path |

### `dot note write`

Write stdin to a note file and commit it

```text
dot note write
```

**Options**

| Option | Description |
| --- | --- |
| `--path` `<path>` | Note file path |
| `--stdin` | Read note content from stdin |

### `dot note delete`

Delete a note file and commit it

```text
dot note delete
```

**Options**

| Option | Description |
| --- | --- |
| `--path` `<path>` | Note file path |

## `dot agents-sync`

Sync AGENTS.md to Cursor rule

```text
dot agents-sync
```

## `dot opencode-debug`

Debug OpenCode config and paths

```text
dot opencode-debug
```

**Options**

| Option | Description |
| --- | --- |
| `--agent` `<name>` | Debug a specific OpenCode agent |

## `dot setup-private-repo`

Register private pacman repo include

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
| `--skip-review` | Skip local-edit review |

## `dot skill-check`

Validate skill references

```text
dot skill-check
```

**Options**

| Option | Description |
| --- | --- |
| `--open-opencode` | Run checks then open OpenCode analysis |
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

## `dot help`

Show this help menu

```text
dot help
```
