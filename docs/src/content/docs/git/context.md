---
title: Context Integration
description: How dotfiles OpenCode plugins consume the standalone context tool.
sidebar:
  order: 2
---

Generic branch and stack context is provided by the standalone [`context`](https://context.timmo.dev) tool.

Use the commands directly:

```bash
context git
context git --json
context stack
context stack --json
```

The dotfiles repo keeps the OpenCode plugins that consume those JSON payloads:

- `branch-context` runs `context git --json` and renders `<branch-context>` XML for scoped commands.
- `stack-context` runs `context stack --json` and renders `<stack-context>` XML automatically and for `/inject-stack` or `/inject-context`.

For CLI flags, JSON payload shape, and MCP tools, see <https://context.timmo.dev>.
