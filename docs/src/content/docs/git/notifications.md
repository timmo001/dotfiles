---
title: Notifications
description: The shell-native GitHub notification inbox and its CLI actions.
sidebar:
  order: 6
---

## `dot git-notifications`

The authenticated user's GitHub notification inbox. Without machine or action flags it opens the native Omarchy shell panel. Select a thread to open it, or use the final separated item to open the GitHub notifications page.

```bash
dot git-notifications                    # Omarchy shell panel
dot git-notifications --raw              # text summary of notification threads
dot git-notifications --bar-json        # JSON for status bars and shell modules
dot git-notifications --list-threads     # notification threads as rows
dot git-notifications --participating    # only participating or mentioned threads
dot git-notifications --all              # include read notifications
```

### Actions

```bash
dot git-notifications --mark-read <id>   # mark a thread read
dot git-notifications --mark-done <id>   # mark a thread done
dot git-notifications --ignore <id>      # ignore new notifications for a thread
dot git-notifications --unignore <id>    # stop ignoring a thread
```

### Bot notifications

```bash
dot git-notifications --mark-bot-read --dry-run  # preview matched bot threads
dot git-notifications --mark-bot-read            # mark Renovate/Dependabot/bot threads read
```

Use `--dry-run` first to preview the threads that would be marked.

## Requirements

The notification API requires `gh` authenticated with a classic token carrying the `notifications` or `repo` scope.

## Status bar module

The `timmo.git` Quickshell plugin polls `dot git-notifications --bar-json` and combines its filtered threads with repository state in one bar widget and native panel. Notification surfaces hide repos that are not enabled in `dot-git.yml`, while upstream notifications can match a managed fork's `remote.upstream.url`. The shell panel opens thread URLs, provides a final link to the GitHub inbox, and refreshes both Git sources together. The stowed `git-notifications-bar` cache command remains available to generic status bars. `dot doctor` verifies GitHub notification API access.
