---
title: Diff & Repo Watcher
description: Track dirty worktrees and ahead/behind state across managed repositories from the CLI and Omarchy Shell panel.
sidebar:
  order: 2
---

## `dot git-diff`

`dot git-diff` scans every managed repository: public and private dotfiles, the notes vault, Omarchy repos (when enabled), and activity-enabled repos from `dot-git.yml`. The default output is a detailed text summary. Explicit list and panel outputs include enabled repositories regardless of their activity schedules.

```bash
dot git-diff                # text summary (alias: dot diff)
dot git-diff --raw          # text summary of repos with changes
dot git-diff --bar-json     # JSON for status bars and shell modules
dot git-diff --panel-json   # full repository snapshot for the shell panel
dot git-diff --list-changed # changed repos as name|path rows
dot git-diff --list-all     # all tracked repos as name|path rows
dot git-diff --no-fetch     # skip upstream fetches; use local refs only
```

The raw summary includes working-tree status, staged and unstaged diff statistics, and ahead/behind commits. `--list-changed` and `--list-all` emit `name|path` rows for scripts. `--bar-json` is schedule-aware status-bar output, while `--panel-json` provides the complete Changed and Other repository lists for the native shell panel.

## Index locks

Status scans run `git --no-optional-locks status` so background polling does not refresh the index or compete with an in-flight rebase, merge, or other index-writing operation. That keeps bar modules and the TUI from creating or waiting on `.git/index.lock` during normal reads.

When a crashed git process leaves a stale lock behind, the repo appears with a lock indicator in the shell panel. Only remove a lock when no git command is actively running in that repository.

## Upstream fetches

When a repo has an upstream configured, `dot git-diff` fetches the tracking branch before computing ahead/behind counts. Fetches are TTL-cached (default five minutes, controlled by `DOT_FETCH_TTL_SECONDS`). Pass `--no-fetch` to skip network fetches and rely on local tracking refs.

## Status bar module

The `timmo.git` Quickshell plugin polls `dot git-diff --bar-json` for its bar state and `dot git-diff --panel-json` for its experimental native repository browser. The same panel combines Changed and Other repositories with GitHub notifications. Repository actions can open lazygit, an editor, an agent with an installed Herdr integration, a terminal, or GitHub. Editor, agent, terminal, and TUI actions focus an existing matching Herdr workspace or create one when a shared Herdr session is running. Lazygit opens in a new pane by default; Ctrl+Enter opens it in a focused named tab, while Shift+Enter runs it in a short-lived floating terminal. Other commands start in a focused named tab. Without Herdr, terminal actions use an ordinary tiled terminal. The stowed `git-diff-bar` cache command remains available to generic status bars. See [Bar Integrations](/bar-integrations/) for the shared JSON contract.

Status-bar polling respects each repository's activity schedule so unattended checks stay within the configured hours.

## Configuration

Which repositories appear is controlled by the private `dot-git.yml` config. See [Private Git Config](/configuration/private-git/).
