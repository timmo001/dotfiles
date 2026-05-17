---
description: Refactor current branch work while preserving behaviour
agent: refactorer
---

Load applicable local skills before editing.
Load the `branch-context-consumer` skill. Use full-context mode.

Follow these steps:

1. Use the `<work-scope>` section in this order:
   - unstaged changes
   - staged changes
   - branch diff against the default branch
2. Use the changed-file and diff-stat entries in `<work-scope>` to identify the refactor scope before reading specific files.
3. Narrow with `${ARGUMENTS}` when the user names a file, function, concern, or sub-area.
4. Keep the work behaviour-preserving and limited to the scoped current work.
5. Load the matching local skills for the files and cleanup type in scope.
6. Run the smallest relevant verification for the touched code.
7. Report briefly:
    - scope used
    - behaviour-preserving refactors made
    - files changed
    - verification run and result

If no safe refactor is justified in the current scope, report that and make no edits.
