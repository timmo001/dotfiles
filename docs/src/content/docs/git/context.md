---
title: Context Integration
description: How dotfiles OpenCode plugins consume the standalone context tool.
sidebar:
  order: 2
---

Generic branch and stack context lives in the standalone [`context`](https://context.timmo.dev) CLI and MCP server. The dotfiles repo no longer embeds that logic in `dot`; it installs the tool, stows shell completions, and keeps the OpenCode plugins that turn the JSON payloads into prompt XML.

## Install

`dot init` installs the `context-git` AUR package from [`.dot-public-packages`](/configuration/private-packages/#public-packages). That package provides the `context` binary on `PATH`. After init, verify in any git checkout:

```bash
context git --json | head
context stack --json | head
```

Shell completions for `context` are stowed from this repo. Regenerate them after upgrading the binary with `context completions bash|fish|zsh`, then `dot stow`. See [Shell Setup](/dot/shell/#shell-completions).

## CLI usage

Use the commands directly when scripting or debugging agent context:

```bash
context git                 # human-readable branch context
context git --json          # structured payload for tools and plugins
context stack               # human-readable tech-stack summary
context stack --json        # structured stack payload
context help git            # command help (also exposed as an MCP resource)
```

`NO_COLOR` disables ANSI colour in TTY-aware output. See [Environment Variables](/configuration/environment/#debugging-and-output).

## MCP server

Repository context tools moved out of `dot mcp` into the standalone server:

```bash
context mcp
```

Typical tools (names from `tools/list`):

| Tool | Purpose |
| --- | --- |
| `git_context` | Branch context for the current repository |
| `stack_context` | Tech-stack summary for a directory |
| `command_help` | Help text for a `context` subcommand |

Read-only resources include `context://git`, `context://stack`, and `context://command/{name}`. Wire the server in an agent harness the same way as [`dot mcp`](/dot/mcp/#launching-from-a-harness), using `["context", "mcp"]` as the command. Full schemas and examples are on <https://context.timmo.dev/mcp/>.

Use [`notes mcp`](https://notes.timmo.dev/mcp/) for the notes vault. Agent harnesses that need repository context and notes load both standalone stdio servers side by side.

## OpenCode plugins in dotfiles

The dotfiles repo keeps the OpenCode plugins that consume `context` JSON and render prompt blocks:

- `branch-context` runs `context git --json` and injects `<branch-context>` XML for scoped slash commands (full branch context, or work-scope-only variants without the pull request).
- `stack-context` runs `context stack --json` and injects `<stack-context>` XML automatically on the first message of a session inside a git repository, and on demand for `/inject-stack` or `/inject-context`.

Plugin-specific command allowlists and injection rules stay in `agents/.config/opencode/plugins/`. For CLI flags, JSON payload fields, and MCP tool parameters, see <https://context.timmo.dev>.
