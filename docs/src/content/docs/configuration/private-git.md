---
title: Private Git Config
description: The dot-git.yml schema for repo activity, workflows, and notifications.
---

The git and GitHub tooling reads a private YAML config that lists the repositories to track and how. It lives in the private overlay at `$DOTFILES_PRIVATE_DIR/dot-git.yml` by default (override with `DOT_GIT_CONFIG_FILE`).

It is consumed by `dot git-diff`, `dot git-log`, `dot git-workflows`, `dot git-notifications --bar-json`, `dot update`, and `dot doctor`.

## Per-repo keys

Each repo entry has three required sections, each with an explicit `enabled` flag and a 5-field cron `schedule`:

- `activity` — include the repo in `dot git-diff` / `dot git-log` and pull it during `dot update`.
- `workflows` — show the repo's GitHub Actions runs in `dot git-workflows`.
- `notifications` — include the repo in the notification inbox surfaces.

The `notifications.bar.ignore_bot_activity` key controls status-bar bot noise. A repo's `remote.upstream.url` lets upstream notifications match a managed fork.

:::note[Private by default]
`dot-git.yml` lives in the private dotfiles overlay because it contains a machine- and user-specific repository list. The public dotfiles only contain the logic that reads it.
:::

## Requirements

- `dot git-notifications` requires `gh` authenticated with a classic token carrying the `notifications` or `repo` scope.
- `dot doctor` verifies `dot-git.yml`, the active status-bar module wiring, and the absence of legacy `git-workflow-watch` leftovers.
