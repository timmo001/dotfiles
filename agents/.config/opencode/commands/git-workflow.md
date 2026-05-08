---
description: Read branch, diff, and PR context from BranchContextPlugin without extra git calls
agent: ask
---

Load the `git-workflow` skill before proceeding.

`BranchContextPlugin` must inject a `<branch-context>` block before this command runs. Use that injected context as the canonical snapshot for the current task.

Follow these steps:

1. Parse the injected `<branch-context>` block.
2. If `<branch-context>` is absent, stop and report that `BranchContextPlugin` did not inject context for this command.
3. Read the tagged sections in this order when present:
   - `<branch-metadata>`
   - `<status>`
   - `<work-scope>`
   - `<pull-request>`
   - `<warnings>`
4. Summarize the current state in concise sections using the injected tag descriptions as guidance.
5. In `<work-scope>`, use the current work scope in this order: unstaged, staged, then branch diff.
6. Prefer the precomputed changed-file and diff-stat entries from `<work-scope>` over reconstructing scope yourself.
7. Do not print raw patch hunks (`diff --git`, `index`, `@@`, `+`, `-` line content) unless the user explicitly asks for them.
8. Do not run additional `git` or `gh` commands unless the user explicitly asks for a fresh snapshot.
9. Report briefly:
   - scope source used (`BranchContextPlugin` context)
   - branch state
   - changed files summary
   - PR/check state when available
