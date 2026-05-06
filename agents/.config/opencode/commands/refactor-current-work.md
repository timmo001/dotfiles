---
description: Refactor current branch work while preserving behaviour
agent: refactorer
---

Load applicable local skills before editing.

`BranchContextPlugin` must inject a `<branch-context>` block before this command runs. Use that injected context as the canonical refactor scope.

Follow these steps:

1. Parse the injected `<branch-context>` block.
2. If `<branch-context>` is absent, stop and report that `BranchContextPlugin` did not inject context for this command.
3. Use the current work scope in this order:
   - unstaged changes
   - staged changes
   - branch diff against the default branch
4. Use the changed-file and diff-stat sections to identify the refactor scope before reading specific files.
5. Narrow with `${ARGUMENTS}` when the user names a file, function, concern, or sub-area.
6. Keep the work behaviour-preserving and limited to the scoped current work.
7. Load the matching local skills for the files and cleanup type in scope.
8. Run the smallest relevant verification for the touched code.
9. Report briefly:
   - scope used
   - behaviour-preserving refactors made
   - files changed
   - verification run and result

If no safe refactor is justified in the current scope, report that and make no edits.
