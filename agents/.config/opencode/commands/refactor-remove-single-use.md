---
description: Refactor - inline and remove safe single-use functions from current git scope
agent: refactorer
---

Load and apply the `remove-single-use-functions` skill before editing.
Load the `branch-context-consumer` skill. Use work-scope mode.

1. From files in scope (optionally narrowed by `${ARGUMENTS}`), find functions added or modified in the current work that are now used exactly once.

2. Apply the smallest safe cleanup that satisfies the `remove-single-use-functions` skill.

3. Run the smallest relevant verification for the touched code (targeted test, typecheck, lint, or build check).

4. Report briefly:
    - scope source used (`BranchContextPlugin` context)
    - functions removed
    - files changed
    - verification run + result

If no safe single-use function exists, report that and make no edits.
