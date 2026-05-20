---
description: Apply all TypeScript-specific skills in current git scope
---

Follow current instructions before making changes.
Follow local project guidance while editing.

Load and apply all local skills with names ending in `-ts` before editing.
Also apply cleanup skills when TypeScript changes include local aliases, temporary variables, or local helper wrappers.
Use the `fallow` skill when TypeScript scope analysis needs dead-code, duplication, circular dependency, or complexity evidence.

At minimum, apply:

- `types-enforce-ts`
- `cleanup-unnecessary-variables`
- `remove-single-use-functions`

Load the `branch-context-consumer` skill. Use work-scope mode.

1. Limit work to TypeScript files in scope (`.ts`, `.tsx`, `.mts`, `.cts`).
2. Optionally narrow scope by `${ARGUMENTS}` when provided.
3. Apply the smallest safe changes that satisfy all applicable `*-ts` and cleanup skills.
4. Run the smallest relevant verification (targeted typecheck/test/lint/build).
5. Report briefly:
   - scope source used (`BranchContextPlugin` context)
   - TS skills applied
   - files changed
   - verification run + result

If no safe TypeScript skill improvement exists, report that and make no edits.
