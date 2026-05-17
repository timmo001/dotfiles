---
description: Refactor - inline and remove unnecessary variables from current git scope
agent: refactorer
---

Load and apply the `cleanup-unnecessary-variables` skill before editing.
Load the `branch-context-consumer` skill. Use work-scope mode.

1. From files in scope (optionally narrowed by `${ARGUMENTS}`), find variables added or modified in the current work that are unnecessary and safe to remove.

2. Apply the smallest safe cleanup that satisfies the `cleanup-unnecessary-variables` skill.

3. Run the smallest relevant verification for the touched code (targeted test, typecheck, lint, or build check).

4. Report briefly:
    - scope source used (`BranchContextPlugin` context)
    - variables removed or inlined
    - files changed
    - verification run + result

If no safe unnecessary variable cleanup exists, report that and make no edits.
