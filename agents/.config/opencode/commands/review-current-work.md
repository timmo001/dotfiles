---
description: Review current branch work with BranchContextPlugin context
agent: reviewer
---

Load the `pr-review` skill before proceeding.
Load the `branch-context-consumer` skill. Use full-context mode.

Follow these steps:

1. Review the current work using the `<work-scope>` section in this order:
   - unstaged changes
   - staged changes
   - branch diff against the default branch
2. Use the changed-file and diff-stat entries in `<work-scope>` to identify the review scope before reading specific files.
3. Read full files when needed to verify behavior, not only diffs.
4. Do not run additional `git` or `gh` commands unless the user explicitly asks for a fresh snapshot.
5. Report findings first, ordered by severity, with file paths and line numbers when possible.
6. If no findings are discovered, say that explicitly and note any residual testing or context gaps.
