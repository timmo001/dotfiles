---
description: Read branch, diff, and PR context from BranchContextPlugin without extra git calls
agent: ask
---

Load the `git-workflow` skill before proceeding.
Load the `branch-context-consumer` skill. Use full-context mode.

Follow these steps:

1. Summarize the current state in concise sections using the injected tag descriptions as guidance.
2. In `<work-scope>`, use the current work scope in this order: unstaged, staged, then branch diff.
3. Prefer the precomputed changed-file and diff-stat entries from `<work-scope>` over reconstructing scope yourself.
4. Do not print raw patch hunks (`diff --git`, `index`, `@@`, `+`, `-` line content) unless the user explicitly asks for them.
5. Do not run additional `git` or `gh` commands unless the user explicitly asks for a fresh snapshot.
6. Report briefly:
   - scope source used (`BranchContextPlugin` context)
   - branch state
   - changed files summary
   - PR/check state when available
