---
title: MCP Server
description: Run dot as a Model Context Protocol server over stdio.
sidebar:
  order: 8
---

`dot mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. It exposes the repository notes vault to any MCP-capable agent harness through the same `dot` binary, so note tools talk to one implementation.

Generic git and stack context tools live in the standalone [`context`](https://context.timmo.dev) MCP server (`context mcp`).

The server is launched by an MCP client, not run interactively. It speaks JSON-RPC on stdout and sends all logging to stderr, so stdout stays protocol-clean.

## Tools

Agent harnesses that load this server under the name `dot` expose tools with a `dot_` prefix (for example `dot_note_read`). The tables below use the raw MCP tool names from `tools/list`.

### Notes tools

| Tool          | Description                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `note_read`   | Read a note file from the vault.                                                                                                                |
| `note_list`   | List notes for the current repository (optionally filtered by tag, or across all repositories).                                                 |
| `note_write`  | Write a note file, then commit and best-effort push it. Sets or refreshes the frontmatter `date:` to the current local timestamp automatically. |
| `note_delete` | Delete a note file, then commit and best-effort push it.                                                                                        |

The tools call `dot`'s in-process notes service directly, so they behave like `dot note` and `dot notes` on the command line. Read and list are annotated read-only; write and delete are annotated destructive.

#### `note_read` parameters

| Parameter | Required | Purpose                                                                                                               |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `path`    | yes      | Absolute path to the note file in the vault (for example `/home/user/Documents/notes/repo-notes/owner/repo/slug.md`). |

Returns the raw markdown body. This is the only permitted way to read vault files when the `notes-guard` plugin is active.

#### `note_list` parameters

| Parameter | Default | Purpose                                                                              |
| --------- | ------- | ------------------------------------------------------------------------------------ |
| `tag`     | —       | Optional tag filter (for example `handoff`). Case-insensitive.                       |
| `all`     | `false` | List notes from every `repo-notes` directory instead of the current repository only. |

Returns JSON. For the current repo, the payload is a flat array of entries with `filename`, `filePath`, `name`, `description`, `tags`, `priority`, and `mtime`. With `all: true`, the payload is grouped into sections (`repoSlug`, `notesPath`, `entries`).

#### `note_write` parameters

| Parameter | Required | Purpose                                                |
| --------- | -------- | ------------------------------------------------------ |
| `path`    | yes      | Absolute path to the note file to create or overwrite. |
| `content` | yes      | Full file content, including frontmatter and body.     |

Commits the vault after writing and best-effort pushes when a remote is configured. Refreshes the frontmatter `date:` to the current local timestamp automatically. Output includes the commit result and, when applicable, the push outcome.

#### `note_delete` parameters

| Parameter | Required | Purpose                                   |
| --------- | -------- | ----------------------------------------- |
| `path`    | yes      | Absolute path to the note file to delete. |

Commits and best-effort pushes the deletion. Deletion is irreversible; agents should confirm with the user before calling this tool.

### Context tools

Context tools moved to [`context mcp`](https://context.timmo.dev/mcp/):

- `git_context`
- `stack_context`
- `command_help`

Keep the `dot` MCP server for notes and load the `context` MCP server alongside it when an agent harness needs repository context tools.

## Resources

The server also exposes read-only [resources](https://modelcontextprotocol.io/specification/latest/server/resources) a client can pull in as context. Resource support varies by harness, so they are a progressive enhancement on top of the tools.

| Resource               | Description                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `dot://notes/context`  | The current repository's OpenCode repo-note context block: identity, notes path, and recent notes. |
| `dot://command/{name}` | Help text for a single dot command (template).                                                     |

Each resource re-runs on every read, so it reflects the current state. Use `context://git` and `context://stack` from the standalone context MCP server for generic repository context resources, and `context://command/{name}` for context CLI command help.

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
