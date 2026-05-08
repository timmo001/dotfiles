---
description: Refactor current branch work while preserving behaviour
agent: refactorer
---

Load applicable local skills before editing.

`BranchContextPlugin` must inject a `<branch-context>` block before this command runs. Use that injected context as the canonical refactor scope.

Follow these steps:

1. Parse the injected `<branch-context>` block.
2. If `<branch-context>` is absent, stop and report that `BranchContextPlugin` did not inject context for this command.
3. Read `<branch-metadata>`, `<status>`, `<work-scope>`, `<pull-request>` when present, and `<warnings>` when present.
4. Use the `<work-scope>` section in this order:
   - unstaged changes
   - staged changes
   - branch diff against the default branch
5. Use the changed-file and diff-stat entries in `<work-scope>` to identify the refactor scope before reading specific files.
6. Narrow with `${ARGUMENTS}` when the user names a file, function, concern, or sub-area.
7. Keep the work behaviour-preserving and limited to the scoped current work.
8. Load the matching local skills for the files and cleanup type in scope.
9. Run the smallest relevant verification for the touched code.
10. Report briefly:
    - scope used
    - behaviour-preserving refactors made
    - files changed
    - verification run and result

If no safe refactor is justified in the current scope, report that and make no edits.
