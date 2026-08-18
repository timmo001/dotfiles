---
title: Agents / LLMs
description: Machine-readable documentation and hosted MCP tools for AI-assisted sessions.
---

This site publishes [llms.txt](https://llmstxt.org) bundles, raw Markdown pages, and a hosted MCP server. They are generated at build time from the same source as the site, which keeps them aligned with the published pages without maintaining a second copy.

Use them when you want the dotfiles docs available outside the browser: setup steps, command behaviour, configuration notes, and the generated reference pages can all be pulled from the same published source.

## Pick A File

| File                               | Contents                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `/llms.txt`      | Start here for a compact index of every published page. |
| `/llms-full.txt` | Use this when the task needs the whole docs site in one file. |
| `/{route}.md`    | Fetch one rendered page as plain Markdown. |

The full bundle is the safest default for broad questions because it includes the generated command and OpenCode reference pages alongside the hand-written docs. Use a page's `.md` URL for focused lookups where a smaller prompt matters more than complete coverage.

## Copy-Ready URLs

Complete docs bundle:

```text
https://dotfiles.timmo.dev/llms-full.txt
```

Hosted MCP endpoint:

```text
https://dotfiles.timmo.dev/mcp
```

Bundle index:

```text
https://dotfiles.timmo.dev/llms.txt
```

## Notes

- The bundles are generated from the docs source during the site build. If a page is stale, fix the source page rather than editing the generated text output.
- The URLs are stable, but the contents change whenever the docs are rebuilt from new commits.
- The MCP server exposes read-only search, page, page-list, and navigation tools. It does not call a language model or require an AI API key.
- Ask AI is intentionally disabled. Copy as Markdown, Open in chat, WebMCP, and the agent-readability manifest remain available without model usage.
- For repository-specific work, pair these docs with current branch context from [`context git`](https://context.timmo.dev/context/git/) and tech-stack context from [`context stack`](https://context.timmo.dev/context/stack/). The docs explain the workflow; the commands explain the live checkout.
