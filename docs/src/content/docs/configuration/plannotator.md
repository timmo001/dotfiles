---
title: Plannotator
description: Restore shared Plannotator review settings across devices.
sidebar:
  order: 6
---

Plannotator provides a local browser interface for reviewing plans, code changes, files, folders, and web pages. The CLI is installed from the pinned `backnotprop/plannotator` GitHub release through mise because it is not available from Arch, AUR, or the Aqua registry.

See the [Plannotator documentation](https://plannotator.ai/docs/) for installation, commands, OpenCode integration, configuration, remote use, and sharing.

## Dotfiles integration

This setup adds:

- The `plannotator` CLI through mise's GitHub backend.
- The `@plannotator/opencode` plugin in the private OpenCode configuration.
- `/plannotator-review`, `/plannotator-annotate`, and `/plannotator-last` command registrations.
- A public stow package for portable settings.

The plugin uses the `plan-agent` workflow and explicitly targets OpenCode's built-in `plan` agent. The `/plan` command starts that agent directly, while execution agents such as `ask`, `build-ask`, and `refactorer` can hand broad work to it through `plan_enter`. They do not need to be listed as Plannotator planning agents because `submit_plan` runs after the handoff, inside the built-in `plan` agent.

This keeps `submit_plan` out of build and specialist agents. The plugin's `planningAgents` option only needs another name if a separate custom planning agent is added later.

The command files contain frontmatter only because the plugin handles their names through OpenCode's command hook. Restart OpenCode after changing its plugin configuration.

For usage, see the upstream [OpenCode integration guide](https://plannotator.ai/docs/guides/opencode/) and its linked command guides.

Code review feedback authorises the agent to apply the requested corrections immediately. The correction run stays within the human feedback, performs relevant validation, and asks before proceeding when a request is unclear, conflicts with the codebase, or cannot be applied safely.

## Local data

Only `config.json` belongs in dotfiles. The rest of `~/.plannotator/` contains runtime or machine-local data and is deliberately not tracked:

This includes drafts, sessions, semantic-diff data, history, and saved plans. Keeping these directories local avoids publishing reviewed project content, transient state, or machine-specific session details.
