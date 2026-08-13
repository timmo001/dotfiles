---
title: Diff & Repo Watcher
description: The dot git-diff TUI and CLI for tracking dirty worktrees and ahead/behind state across managed repos.
sidebar:
  order: 2
---

## `dot git-diff`

A two-pane repo watcher across every managed repository: public and private dotfiles, the notes vault, Omarchy repos (when enabled), and schedule-gated activity repos from `dot-git.yml`. The **Changed** pane lists repos with uncommitted changes or non-zero ahead/behind counts against their upstream; **Other** lists the rest.

```bash
dot git-diff                # interactive TUI (alias: dot diff)
dot git-diff --raw          # text summary of repos with changes
dot git-diff --bar-json     # JSON for status bars and shell modules
dot git-diff --list-changed # changed repos as name|path rows
dot git-diff --list-all     # all tracked repos as name|path rows
dot git-diff --no-fetch     # skip upstream fetches; use local refs only
dot git-diff --tab other    # open with the Other pane focused
dot git-diff --repo dotfiles # open a changed repo directly in lazygit
```

The TUI polls every ten seconds and performs an initial poll for a fast first paint.
`--repo <name>` selects a changed repository and immediately suspends the TUI into lazygit. Quitting lazygit resumes the diff TUI with that repository still selected.

## TUI layout

| Pane | Contents |
| --- | --- |
| Changed | Repos with dirty worktrees or ahead/behind upstream |
| Other | Tracked repos with a clean worktree and no ahead/behind drift |

The status bar shows when the last poll ran, how many repos changed, and how many have a stale `.git/index.lock` file. Repos with a lock file show a lock icon in the list.

## Keyboard

| Key | Action |
| --- | --- |
| ↑ / ↓ | Navigate the active pane |
| Tab | Switch between Changed and Other |
| Enter | Open lazygit in the selected repo (suspends the TUI) |
| `e` | Open the repo in your default editor |
| `E` | Open the repo in your visual editor |
| `o` | Open an interactive OpenCode session |
| `O` | Open an OpenCode plan session |
| `t` | Open a terminal in the repo directory |
| `w` | Open the repo on GitHub in the browser |
| `x` | Remove a stale `.git/index.lock` from the selected repo |
| `r` | Refresh immediately |
| Esc / Backspace | Return to the main menu |

Repo pulls and fetches are not available from this view; use `dot update` or work inside the repo directly.

## Index locks

Status scans run `git --no-optional-locks status` so background polling does not refresh the index or compete with an in-flight rebase, merge, or other index-writing operation. That keeps bar modules and the TUI from creating or waiting on `.git/index.lock` during normal reads.

When a crashed git process leaves a stale lock behind, the repo appears with a lock indicator. Press `x` on the selected repo to remove the lock file and trigger a refresh. Only remove a lock when no git command is actively running in that repository.

## Upstream fetches

When a repo has an upstream configured, `dot git-diff` fetches the tracking branch before computing ahead/behind counts. Fetches are TTL-cached (default five minutes, controlled by `DOT_FETCH_TTL_SECONDS`). Pass `--no-fetch` to skip network fetches and rely on local tracking refs.

## Status bar module

The `timmo.git` Quickshell plugin polls `dot git-diff --bar-json` and combines its repository rows with GitHub notifications in one bar widget and native panel. The panel opens the Changed or Other TUI separately and refreshes both sources together. The stowed `git-diff-bar` cache command remains available to generic status bars. See [Bar Integrations](/bar-integrations/) for the shared JSON contract.

## Configuration

Which repositories appear is controlled by the private `dot-git.yml` config. See [Private Git Config](/configuration/private-git/).
