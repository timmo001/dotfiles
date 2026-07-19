---
title: Workflow Runs
description: Watched GitHub Actions runs for each repo's locally checked-out HEAD commit.
sidebar:
  order: 5
---

## `dot git-workflows`

A two-pane view of watched GitHub workflow runs. The left pane lists watched repositories from the private repo list; the right pane lists runs for the selected repo's locally checked-out HEAD commit. Disabled workflows are hidden.

```bash
dot git-workflows                # interactive TUI
dot git-workflows --raw          # text summary of watched workflow runs
dot git-workflows --bar-json     # JSON for status bars and shell modules
dot git-workflows --list-repos   # watched repo summaries as rows
dot git-workflows --list-runs    # workflow runs as rows
dot git-workflows --since <date> # only runs active at or after this date
```

The `--since` filter accepts ISO/RFC/epoch dates and relative values such as `1h` or `1 hour ago`. For status bars, combine `--bar-json` with `--since`:

```bash
dot git-workflows --bar-json --since "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%SZ)"
```

## Status bar module

A status bar module refreshes `dot git-workflows --bar-json --since <one-hour-ago>` through its own short-lived cache; left click opens the filtered TUI and right click refreshes the cache. `dot doctor` verifies `dot-git.yml`, the active workflow-runs module wiring, and the absence of legacy `git-workflow-watch` leftovers.

:::note
The old `git-workflow-watch` hook and its user systemd timer are obsolete and should not be installed.
:::
