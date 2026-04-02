---
allowed-tools: Read(*), Grep(*), Glob(*), Bash(git:*)
description: Read up on the current branch and quickly summarize code changes
agent: ask
---

# Read Current Branch

Read the current branch status and summarize what changed compared to the default branch.

`BranchContextPlugin` injects a `<branch-context>` block before this command runs. Use that injected context as your primary source of truth.

Follow these steps:

1. Parse the injected `<branch-context>` block and treat it as the canonical snapshot.
2. Summarize branch intent and key code changes grouped by area.
3. Call out risky changes, missing tests, or unclear behavior.
4. Run additional `git` commands only if the injected context is missing, stale, or insufficient.
5. Keep the response brief and focused on what changed and how it works.
