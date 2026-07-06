---
title: MCP Server
description: Run dot as a Model Context Protocol server over stdio.
sidebar:
  order: 8
---

`dot mcp` starts a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio for dot-owned resources. It is launched by an MCP client, not run interactively. It speaks JSON-RPC on stdout and sends all logging to stderr, so stdout stays protocol-clean.

Generic git and stack context tools live in the standalone [`context`](https://context.timmo.dev) MCP server (`context mcp`). Repository note tools live in the standalone [`notes`](https://notes.timmo.dev) MCP server (`notes mcp`).

## Resources

| Resource               | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `dot://command/{name}` | Help text for a single dot command (template). |

Use `context://git`, `context://stack`, and `context://command/{name}` from `context mcp` for generic repository context. Use `notes://context` and note tools from `notes mcp` for repository notes.

## Launching from a harness

Point an MCP client at the `dot` binary with the `mcp` argument. For an OpenCode `opencode.json`:

```json
{
  "mcp": {
    "dot": {
      "type": "local",
      "command": ["dot", "mcp"],
      "enabled": true
    },
    "notes": {
      "type": "local",
      "command": ["notes", "mcp"],
      "enabled": true
    }
  }
}
```

Other harnesses use their own MCP config format but launch the same commands over stdio.

## Smoke test

Pipe JSON-RPC requests to confirm the server responds. A quoted heredoc keeps the JSON intact (no shell escaping), and the trailing `sleep` holds stdin open long enough for the server to reply before it reaches end-of-input:

```bash
{ cat <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"resources/list","params":{}}
EOF
sleep 1; } | dot mcp
```

The server prints the `initialize` and `resources/list` results, then exits when stdin closes. A client disconnect (stdin end, `SIGINT`, or `SIGTERM`) is a normal shutdown, so `dot mcp` returns exit code 0 without an error.

See the [command reference](/dot/commands/#dot-mcp) for the command entry.
