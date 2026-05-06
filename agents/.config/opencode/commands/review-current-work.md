---
description: Review current branch work with BranchContextPlugin context
agent: reviewer
---

Load the `pr-review` skill before proceeding.

`BranchContextPlugin` must inject a `<branch-context>` block before this command runs. Use that injected context as the canonical review snapshot.

Follow these steps:

1. Parse the injected `<branch-context>` block.
2. If `<branch-context>` is absent, stop and report that `BranchContextPlugin` did not inject context for this command.
3. Review the current work using this scope order:
   - unstaged changes
   - staged changes
   - branch diff against the default branch
4. Use the changed-file and diff-stat sections to identify the review scope before reading specific files.
5. Read full files when needed to verify behavior, not only diffs.
6. Do not run additional `git` or `gh` commands unless the user explicitly asks for a fresh snapshot.
7. Report findings first, ordered by severity, with file paths and line numbers when possible.
8. If no findings are discovered, say that explicitly and note any residual testing or context gaps.
