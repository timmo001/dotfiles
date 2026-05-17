---
description: Refactor - enforce TypeScript type safety in current git scope
agent: refactorer
---

Load and apply the `types-enforce-ts` skill before editing.
Load the `branch-context-consumer` skill. Use work-scope mode.

1. Before editing, search local project guidance and reusable type sources:
   - local guidance/docs (for example `AGENTS.md`, project style guides, lint/type config)
   - helper/data/type files that may already define reusable interfaces, unions, enums, and utility types
   - prefer reusing or extending existing local types instead of creating duplicate one-off types

2. From files in scope (optionally narrowed by `${ARGUMENTS}`), find TypeScript edits that weaken types or bypass type safety.

3. Apply the smallest safe type fixes that satisfy the `types-enforce-ts` skill.

4. Run the smallest relevant verification for the touched code (targeted typecheck, test, lint, or build check).

5. Report briefly:
    - scope source used (`BranchContextPlugin` context)
    - type issues fixed
    - files changed
    - verification run + result

If no safe TypeScript type-safety improvement exists, report that and make no edits.
