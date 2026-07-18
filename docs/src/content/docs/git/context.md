---
title: Context Integration
description: How dotfiles OpenCode plugins consume the standalone context tool.
sidebar:
  order: 3
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

Repository context tools are provided by the standalone `context` MCP server:

```bash
context mcp
```

Typical tools (names from `tools/list`):

| Tool | Purpose |
| --- | --- |
| `git_context` | Branch context for the current repository |
| `stack_context` | Tech-stack summary for a directory |
| `command_help` | Help text for a `context` subcommand |

Read-only resources include `context://git`, `context://stack`, and `context://command/{name}`. Wire the server in an agent harness with `["context", "mcp"]` as the command. Full schemas and examples are on <https://context.timmo.dev/mcp/>.

Use [`notes mcp`](https://notes.timmo.dev/mcp/) for the notes vault. Agent harnesses that need repository context and notes load both standalone stdio servers side by side.

## OpenCode plugins in dotfiles

The dotfiles repo keeps the OpenCode plugins that consume `context` JSON and render prompt blocks:

- `branch-context` runs `context git --json` and injects `<branch-context>` XML for scoped slash commands (PR-inclusive branch context, or work-scope-only variants without the pull request). PR descriptions are capped at 4,000 characters; up to 20 comments and 20 reviews are included, with each body capped at 2,000 characters.
- `stack-context` runs `context stack --json` and injects `<stack-context>` XML automatically on the first message of a session inside a git repository, and on demand for `/inject-stack` or `/inject-context`.

Plugin-specific command allowlists and injection rules stay in `agents/.config/opencode/plugins/`. For CLI flags, JSON payload fields, and MCP tool parameters, see <https://context.timmo.dev>.

## Injected XML blocks

The plugins render the structured JSON into tagged XML sections. Treat injected blocks as the primary source for branch and stack analysis; avoid re-running `git`/`gh` or re-scanning the tree unless the user asks for a fresh snapshot or the block reports collection failure.

### Branch context (`<branch-context>`)

| Section | Purpose |
| --- | --- |
| `context-metadata` | How the snapshot was produced (`context git --json`) and when it was generated. |
| `branch-metadata` | Repository identity, current branch, HEAD, default remote/branch, base ref, upstream, ahead/behind, and whether HEAD is on the default branch. Unresolved default-branch metadata is labelled `(unresolved)` rather than guessed. |
| `status` | Compact `git status -sb` summary. |
| `work-scope` | Current work scope in priority order: unstaged, staged, then branch-only changes. On the default branch, branch scope is skipped and recent commits are shown instead. |
| `pull-request` | PR metadata, description, comments, reviews, and checks (branch-focused commands only). |
| `truncations` | Applied output limits. Treat affected sections as partial. |
| `warnings` | Non-fatal collection issues, fallbacks, or missing data. |

`work-scope` reflects the producer's `workScope.state`:

| State | Meaning |
| --- | --- |
| `collected` | Branch-only commits, files, and diff stat are present. |
| `not-applicable` | HEAD is on the default branch; branch scope is skipped and recent commits are shown. |
| `unresolved` | Default branch could not be resolved; recent commits are shown with a reason. |

Work-scope-only commands (for example scoped refactor helpers) call `context git --json --no-pr` and omit the `pull-request` section.

### Stack context (`<stack-context>`)

| Section | Purpose |
| --- | --- |
| `context-metadata` | How the snapshot was produced (`context stack --json`), repository root, and files scanned. |
| `languages` | Detected languages with file counts and general locations. |
| `ecosystems` | Package ecosystems from manifest files. |
| `tooling` | Package managers, linters, formatters, task runners, build tools, and test runners from lockfiles and configs. |
| `frameworks` | Frameworks and libraries from declared dependencies. |
| `truncations` | Scan or output limits that make a section partial. |
| `warnings` | Non-fatal collection issues. |

Automatic session injection runs at most once per session and only inside a git worktree with a non-empty detection result.

## MCP refresh outside plugin-backed commands

Plugin injection covers registered slash commands. For ad-hoc work (for example `/commit` scope checks or manual branch inspection), use the Context MCP server's `git_context` tool with only the fields the task needs (`diff`, `branchDiff`, PR details, and so on). See [Commit Gateway](/git/commit/#agent-workflow) for the commit path.
