---
allowed-tools: Read(*), Grep(*), Glob(*), Bash(git:*), Bash(gh:*)
description: Read up on the current branch and summarize changes
agent: ask
---

# Read Current Branch

Read the current branch status and summarize what changed compared to the default branch.

`BranchContextPlugin` injects a `<branch-context>` block before this command runs. Use that injected context as your primary source of truth.

Follow these steps:

1. Parse the injected `<branch-context>` block and treat it as the canonical snapshot.
2. Summarize branch intent and key code changes grouped by area.
3. Call out risky changes, missing tests, or unclear behavior.
4. Include PR/check status when present.
5. Run additional `git`/`gh` commands only if the injected context is missing, stale, or insufficient.
