---
allowed-tools: Read(*), Grep(*), Glob(*), Bash(git:*)
description: Return formatted branch context with concise change summary
agent: ask
---

# Read Current Branch

Read the current branch status and return formatted context with a concise, factual change summary.

`BranchContextPlugin` injects a `<branch-context>` block before this command runs. Use that injected context as your primary source of truth.

Follow these steps:

1. Parse the injected `<branch-context>` block and treat it as the canonical snapshot.
2. Include a short `Change Summary` section with factual bullets of what changed.
3. Format the remaining `<branch-context>` details into clear sections and bullet points.
4. Keep wording factual only; do not add opinions or recommendations.
5. Do not print raw diffs or patch hunks (`diff --git`, `index`, `@@`, `+`, `-` line content).
6. If diff content exists in `<branch-context>`, ignore it and only include non-diff metadata.
7. Run additional `git` commands only if the injected context is missing, stale, or insufficient.
