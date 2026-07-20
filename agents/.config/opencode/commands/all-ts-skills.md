---
description: Apply all TypeScript-specific skills in current git scope
---

Follow current instructions before making changes.
Follow local project guidance while editing.

Load and apply all local skills with names ending in `-ts` before editing.
Also apply cleanup skills when TypeScript changes include local aliases, temporary variables, or local helper wrappers.
At minimum, apply:

- `types-enforce-ts`
- `cleanup-unnecessary-variables`
- `remove-single-use-functions`

Load the `branch-context-consumer` skill. Use work-scope mode.

Use the injected `<work-scope>` as the refactor boundary. Use `${ARGUMENTS}` only to narrow that current-work scope.

Limit work to TypeScript files in scope (`.ts`, `.tsx`, `.mts`, `.cts`). Apply the smallest safe changes that satisfy all applicable `*-ts` and cleanup skills.

Run the smallest relevant verification. Report the scope source used, TS skills applied, files changed, and verification result.

If no safe TypeScript skill improvement exists, report that and make no edits.
