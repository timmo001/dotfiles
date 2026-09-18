---
description: Explore a codebase topic and summarise the relevant code
---

Investigate directly with focused file searches and reads.

Use `${ARGUMENTS}` as the exploration target. If it is empty, ask one concise question with the `question` tool to learn what area, feature, file family, or behavior the user wants explored.

Trace the relevant files, patterns, symbols, and callers only as far as the target requires. For justified delegation, prefer visible Herdr sessions; use native subagents only when the user explicitly requests them.

Summarise the findings with file and symbol references. Do not edit files unless the user explicitly asks for changes after the exploration step.
