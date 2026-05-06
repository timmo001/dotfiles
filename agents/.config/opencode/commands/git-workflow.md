---
description: Read branch, diff, and PR context from BranchContextPlugin without extra git calls
agent: ask
---

Load the `git-workflow` skill before proceeding.

`BranchContextPlugin` must inject a `<branch-context>` block before this command runs. Use that injected context as the canonical snapshot for the current task.

Follow these steps:

1. Parse the injected `<branch-context>` block.
2. If `<branch-context>` is absent, stop and report that `BranchContextPlugin` did not inject context for this command.
3. Summarize the current state in concise sections:
   - branch metadata
   - current work scope in this order: unstaged, staged, then branch diff
   - pull request status when present
   - warnings when present
4. Prefer the precomputed changed-file and diff-stat sections over raw patch output.
5. Do not print raw patch hunks (`diff --git`, `index`, `@@`, `+`, `-` line content) unless the user explicitly asks for them.
6. Do not run additional `git` or `gh` commands unless the user explicitly asks for a fresh snapshot.
7. Report briefly:
   - scope source used (`BranchContextPlugin` context)
   - branch state
   - changed files summary
   - PR/check state when available
