---
title: LLMs
description: Feed this documentation to an agent using llms.txt.
---

This site publishes [llms.txt](https://llmstxt.org) files so you can hand the whole documentation to a language model or agent in one go. They are generated at build time from the same content as this site.

| File | Contents |
| --- | --- |
| [/llms.txt](/llms.txt) | Index and links to the documentation sets. |
| [/llms-full.txt](/llms-full.txt) | The complete documentation as a single file. |
| [/llms-small.txt](/llms-small.txt) | A compact version with non-essential content removed. |

## Using them

Point an agent or model at the full set:

```text
https://dotfiles.timmo.dev/llms-full.txt
```

Or share the index and let the tool pick the set it needs:

```text
https://dotfiles.timmo.dev/llms.txt
```

The content is generated automatically from the same source as the official documentation, so it stays in sync with this site.
