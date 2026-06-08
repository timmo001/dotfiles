---
description: Apply all Lit rendering skills in current git scope
---

Follow current instructions before making changes.
Follow local project guidance while editing.

Load and apply all local skills with names containing `lit-` before editing.

At minimum, apply:

- `lit-rendering`

Load the `branch-context-consumer` skill. Use work-scope mode.

Use the injected `<work-scope>` as the refactor boundary. Use `${ARGUMENTS}` only to narrow that current-work scope.

Apply the smallest safe changes that satisfy all applicable `lit-*` skills.

Run the smallest relevant verification. Report the scope source used, Lit skills applied, files changed, and verification result.

If no safe Lit skill improvement exists, report that and make no edits.
