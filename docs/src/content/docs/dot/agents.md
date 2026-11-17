---
title: Agents
description: "dot's agent surface: Code Mode tools, the MCP server, the skills and every operation with its access."
---

<!-- Generated from dot/src/commands/AgentTools.ts by `mise run docs:gen:cli`. Do not edit by hand. -->

Agents reach `dot` three ways, all from the same command tree. Try Code Mode first, then MCP, then the CLI with `--json`.

| Surface | What it is |
| --- | --- |
| Code Mode | `dot agent tools --json`, read by the OpenCode `cli-tools` plugin as the `dot` namespace |
| MCP | `dot mcp`, a stdio server with the same tools; job-only ones are left out |
| Skills | The `dot-*` skills in `dotfiles-skills/`, published through `skills.sh.json` |

Install the skills with the [Skills CLI](https://skills.sh):

```bash
npx skills add timmo001/dotfiles
```

Add the MCP server to a harness as a stdio server running `dot mcp`.

## Operations

Write tools ask before they run unless a permission rule allows them. Tools that always ask never save an "always" answer. Job-only tools run through the `jobs` namespace, since they take longer than a tool call should.

| Tool | Command | Access | MCP |
| --- | --- | --- | --- |
| `repo_search` | `dot repo search` | Read | Read-only |
| `repo_list` | `dot repo list` | Read | Read-only |
| `pr_queue` | `dot pr queue` | Read | Read-only |
| `session_status` | `dot session status` | Read | Read-only |
| `session_current` | `dot session current` | Read | Read-only |
| `updates_status` | `dot updates status` | Read | Read-only |
| `services_status` | `dot services status` | Read | Read-only |
| `session_queue` | `dot session queue` | Read | Read-only |
| `pr_reviews` | `dot pr reviews` | Read | Read-only |
| `pr_watch` | `dot pr watch` | Read | Read-only |
| `pr_list` | `dot pr list` | Read | Read-only |
| `agent_lint` | `dot agent lint` | Read | Read-only |
| `herdr_context` | `dot herdr context` | Read | Read-only |
| `herdr_agents` | `dot herdr agents` | Read | Read-only |
| `git_issues` | `dot git issues` | Read | Read-only |
| `git_diff` | `dot git diff` | Read | Read-only |
| `git_log_show` | `dot git log show` | Read | Read-only |
| `skills_validate` | `dot skills validate` | Read | Read-only |
| `skills_check` | `dot skills check` | Read | Read-only |
| `services_run_logs` | `dot services run logs` | Read | Read-only |
| `services_logs` | `dot services logs` | Read | Read-only |
| `services_investigate` | `dot services investigate --print` | Read | Read-only |
| `git_commit` | `dot git commit` | Write | Tool |
| `agent_oxlint` | `dot agent oxlint` | Read | Read-only |
| `herdr_repo_open` | `dot herdr repo open` | Write | Tool |
| `services_schedule_check` | `dot services schedule check` | Read | Read-only |
| `homeassistant_status` | `dot homeassistant status` | Read | Read-only |
| `homeassistant_logs` | `dot homeassistant logs` | Read | Read-only |
| `homeassistant_stop` | `dot homeassistant stop` | Write, always asks | Destructive |
| `snapshot` | `dot snapshot` | Read | Read-only |
| `doctor` | `dot doctor` | Read | Read-only |
| `services_start` | `dot services start` | Write | Tool |
| `services_stop` | `dot services stop` | Write | Tool |
| `session_send` | `dot session send` | Write | Tool |
| `session_take` | `dot session take` | Write | Tool |
| `session_remove` | `dot session remove` | Write, always asks | Destructive |
| `herdr_model` | `dot herdr model` | Write | Tool |
| `herdr_pane_move` | `dot herdr pane move` | Write | Tool |
| `mcp_sync` | `dot mcp sync` | Write | Tool |
| `agent_sync` | `dot agent sync` | Write | Tool |
| `stow` | `dot stow` | Write | Tool |
| `up` | `dot up` | Write | Tool |
| `up_dotfiles` | `dot up dotfiles` | Job only | Left out |
| `up_skills` | `dot up skills` | Job only | Left out |
| `up_repos` | `dot up repos` | Job only | Left out |
| `up_stow` | `dot up stow` | Write | Tool |
| `up_tools` | `dot up tools` | Job only | Left out |
| `up_plugins` | `dot up plugins` | Write | Tool |
| `up_herdr` | `dot up herdr` | Write | Tool |
| `up_agents` | `dot up agents` | Write | Tool |
| `up_shell` | `dot up shell` | Write | Tool |
| `updates_refresh` | `dot updates refresh` | Write | Tool |
| `repo_induct` | `dot repo induct --noninteractive` | Write | Tool |
| `reload` | `dot reload` | Write | Tool |
| `skills_consumers_add` | `dot skills consumers add` | Write | Tool |
| `skills_consumers_remove` | `dot skills consumers remove` | Write, always asks | Destructive |
| `notes_capture_sync` | `dot notes capture sync` | Write | Tool |
