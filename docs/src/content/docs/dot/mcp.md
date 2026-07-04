---
title: MCP Server
description: Run dot as a Model Context Protocol server over stdio.
---

`dot mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. It exposes the repository notes vault and read-only repository context to any MCP-capable harness (OpenCode, Codex, Cursor, Copilot CLI, VS Code, Gemini) through the same `dot` binary, so every tool talks to one implementation.

The server is launched by an MCP client, not run interactively. It speaks JSON-RPC on stdout and sends all logging to stderr, so stdout stays protocol-clean.

## Tools

### Notes tools

| Tool | Description |
| --- | --- |
| `note_read` | Read a note file from the vault. |
| `note_list` | List notes for the current repository (optionally filtered by tag, or across all repositories). |
| `note_write` | Write a note file, then commit and best-effort push it. Sets or refreshes the frontmatter `date:` to the current local timestamp automatically. |
| `note_delete` | Delete a note file, then commit and best-effort push it. |

The tools call `dot`'s in-process notes service directly, so they behave like `dot note` and `dot notes` on the command line. Read and list are annotated read-only; write and delete are annotated destructive.

### Context tools

| Tool | Description |
| --- | --- |
| `git_context` | Branch context for the current repository: repository/branch/base header, ahead/behind state, the pull request summary for a feature branch, unstaged files, staged files, untracked files, branch changed files, and recent commits, with optional remote URLs (`remotes`), PR comments (`comments`), reviews (`reviews`), labels (`labels`), CI checks (`checks`), working-tree diffs (`diff`), or the merge-base diff against the default branch (`branchDiff`). |
| `command_help` | `dot` CLI help. Omit `name` for the full overview, or pass a subcommand (e.g. `git-context`) to scope it. |
| `opencode_debug` | Combined output of the OpenCode debug commands (`paths`, `config`, `skill`, `info`), optionally also inspecting a named `agent`. |

These are all read-only. `git_context` reuses the same text output as `dot git-context`, `command_help` reuses `dot help`, and `opencode_debug` runs the `opencode debug` subcommands and returns their captured output as one text block.

#### `git_context` parameters

Boolean parameters mirror `dot git-context` flags. All are optional; omitted fields use the CLI defaults (PR summary and description on for feature branches; comments, reviews, labels, checks, remotes, and full diffs off).

| Parameter | Default | CLI equivalent |
| --- | --- | --- |
| `diff` | `false` | `--diff` |
| `branchDiff` | `false` | `--branch-diff` |
| `comments` | `false` | `--comments` |
| `reviews` | `false` | `--reviews` |
| `labels` | `false` | `--labels` |
| `checks` | `false` | `--checks` |
| `description` | `true` | omit `--no-description` |
| `pullRequest` | `true` | omit `--no-pr` |
| `remotes` | `false` | `--remotes` |
| `since` | — | `--since <date>` (ISO 8601 or git-relative date) |

See [Context, Diff & Log](/git/context/) for output sections, the OpenCode branch-context plugin, and the `--json` payload shape.

#### `command_help` parameters

| Parameter | Default | Purpose |
| --- | --- | --- |
| `name` | — | Optional subcommand to scope help to (for example `git-context`). Omit for the full `dot` command overview. |

#### `opencode_debug` parameters

| Parameter | Default | Purpose |
| --- | --- | --- |
| `agent` | — | Optional agent name. When set, also runs `opencode debug agent <name>` and appends that section to the combined output. |

When `opencode` is not on `PATH`, the tool returns a single-line error instead of failing the MCP session. Individual debug subcommands that exit non-zero are rendered as `[error] exit <code>` lines inside their section rather than aborting the whole tool.

## Resources

The server also exposes read-only [resources](https://modelcontextprotocol.io/specification/latest/server/resources) a client can pull in as context. Resource support varies by harness, so they are a progressive enhancement on top of the tools.

| Resource | Description |
| --- | --- |
| `dot://notes/context` | The current repository's OpenCode repo-note context block: identity, notes path, and recent notes. |
| `dot://git-context` | Concise branch context for the current repository. |
| `dot://command/{name}` | Help text for a single dot command (template). `{name}` completes from the known commands, e.g. `dot://command/git-context`. |

Each resource re-runs on every read, so it reflects the current state. `dot://git-context` mirrors the `git_context` tool with default parameters (no PR detail flags, no diffs) and `dot://command/{name}` mirrors `command_help`; the resource forms let a client attach them as context without an explicit tool call. Use the `git_context` tool when you need opt-in PR sections or full diffs.

## Notifications

Mutating actions (`note_write`, `note_delete`) emit a desktop notification via `notify-send`, so you stay aware of changes an agent makes in the background regardless of which harness launched the server. The notification is best-effort and never blocks the action.

## Launching from a harness

Point an MCP client at the `dot` binary with the `mcp` argument. For an OpenCode `opencode.json`:

```json
{
  "mcp": {
    "dot": {
      "type": "local",
      "command": ["dot", "mcp"],
      "enabled": true
    }
  }
}
```

Other harnesses use their own MCP config format but launch the same `dot mcp` command over stdio.

## Smoke test

Pipe JSON-RPC requests to confirm the server responds. A quoted heredoc keeps the JSON intact (no shell escaping), and the trailing `sleep` holds stdin open long enough for the server to reply before it reaches end-of-input:

```bash
{ cat <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
EOF
sleep 1; } | dot mcp
```

The server prints the `initialize` and `tools/list` results, then exits when stdin closes. A client disconnect (stdin end, `SIGINT`, or `SIGTERM`) is a normal shutdown, so `dot mcp` returns exit code 0 without an error.

See the [command reference](/dot/commands/#dot-mcp) for the command entry.
