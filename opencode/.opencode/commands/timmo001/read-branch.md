---
allowed-tools: Read(*), Grep(*), Glob(*), Bash(git:*)
description: Return formatted branch context only
agent: ask
---

# Read Current Branch

Read the current branch status and return formatted context only.

`BranchContextPlugin` injects a `<branch-context>` block before this command runs. Use that injected context as your primary source of truth.

Follow these steps:

1. Parse the injected `<branch-context>` block and treat it as the canonical snapshot.
2. Format the `<branch-context>` details into clear sections and bullet points.
3. Do not summarize, analyze, or add commentary/opinions/recommendations.
4. Do not print raw diffs or patch hunks (`diff --git`, `index`, `@@`, `+`, `-` line content).
5. If diff content exists in `<branch-context>`, ignore it and only include non-diff metadata.
6. Run additional `git` commands only if the injected context is missing, stale, or insufficient.
