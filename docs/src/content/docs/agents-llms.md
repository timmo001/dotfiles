---
title: Agents / LLMs
description: Context bundles for working with this documentation in AI-assisted sessions.
---

This site publishes [llms.txt](https://llmstxt.org) bundles so the docs can be loaded as plain text during AI-assisted work. The files are generated at build time from the same source as the site, which keeps them aligned with the published pages without maintaining a second copy.

Use them when you want the dotfiles docs available outside the browser: setup steps, command behaviour, configuration notes, and the generated reference pages can all be pulled from the same published source.

## Pick A File

| File                               | Contents                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| [/llms.txt](/llms.txt)             | Start here when you want an index of the available bundles.                  |
| [/llms-full.txt](/llms-full.txt)   | Use this when the task needs the whole docs site in one file.                |
| [/llms-small.txt](/llms-small.txt) | Use this for quick lookups when the full site is more context than you need. |

The full bundle is the safest default for broad questions because it includes the generated command and OpenCode reference pages alongside the hand-written docs. The compact bundle is better for focused lookups where a smaller prompt matters more than complete coverage.

## Copy-Ready URLs

Complete docs bundle:

```text
https://dotfiles.timmo.dev/llms-full.txt
```

Compact docs bundle:

```text
https://dotfiles.timmo.dev/llms-small.txt
```

Bundle index:

```text
https://dotfiles.timmo.dev/llms.txt
```

## Notes

- The bundles are generated from the docs source during the site build. If a page is stale, fix the source page rather than editing the generated text output.
- The URLs are stable, but the contents change whenever the docs are rebuilt from new commits.
- For repository-specific work, pair these docs with current branch context from [`context git`](https://context.timmo.dev/context/git/) and tech-stack context from [`context stack`](https://context.timmo.dev/context/stack/). The docs explain the workflow; the commands explain the live checkout.
