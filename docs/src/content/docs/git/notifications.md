---
title: Notifications
description: The GitHub notification inbox with read, done, ignore, and bot-read actions.
---

## `dot git-notifications`

The authenticated user's GitHub notification inbox. Without machine or action flags it opens the interactive TUI with open, mark-read, done, ignore, unignore, and bot-read actions.

```bash
dot git-notifications                    # interactive TUI
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
dot git-notifications --ignore <id>      # ignore future notifications for a thread
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

A status bar module refreshes `dot git-notifications --bar-json` through its own short-lived cache. Notification surfaces hide repos that are not enabled in `dot-git.yml`, while upstream notifications can match a managed fork's `remote.upstream.url`. Left click opens `dot git-notifications --bar-filter`; right click refreshes the cache. `dot doctor` verifies GitHub notification API access plus the active notification module wiring.
