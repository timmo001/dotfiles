---
description: Apply all Lit rendering skills in current git scope
---

Follow current instructions before making changes.
Follow local project guidance while editing.

Load and apply all local skills with names containing `lit-` before editing.

At minimum, apply:

- `lit-rendering`

Load the `branch-context-consumer` skill. Use work-scope mode.

1. Work only from files in that scope.
2. Optionally narrow scope by `${ARGUMENTS}` when provided.
3. Apply the smallest safe changes that satisfy all applicable `lit-*` skills.
4. Run the smallest relevant verification (targeted typecheck/test/lint/build).
5. Report briefly:
   - scope source used (`BranchContextPlugin` context)
   - Lit skills applied
   - files changed
   - verification run + result

If no safe Lit skill improvement exists, report that and make no edits.
