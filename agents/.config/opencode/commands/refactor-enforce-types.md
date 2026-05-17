---
description: Refactor - enforce TypeScript type safety in current git scope
agent: refactorer
---

Load and apply the `types-enforce-ts` skill before editing.

`BranchContextPlugin` must inject a `<branch-context>` block before this command runs. Use its `<work-scope>` section as the scope source.

1. Parse the injected `<branch-context>` block and read the `<work-scope>` section in this order: unstaged, staged, then branch diff.

2. If `<branch-context>` is absent, do not run git fallback commands; stop and report that `BranchContextPlugin` did not inject context for this command.

3. Before editing, search local project guidance and reusable type sources:
   - local guidance/docs (for example `AGENTS.md`, project style guides, lint/type config)
   - helper/data/type files that may already define reusable interfaces, unions, enums, and utility types
   - prefer reusing or extending existing local types instead of creating duplicate one-off types

4. From files in scope (optionally narrowed by `${ARGUMENTS}`), find TypeScript edits that weaken types or bypass type safety.

5. Apply the smallest safe type fixes that satisfy the `types-enforce-ts` skill.

6. Run the smallest relevant verification for the touched code (targeted typecheck, test, lint, or build check).

7. Report briefly:
    - scope source used (`BranchContextPlugin` context)
    - type issues fixed
    - files changed
    - verification run + result

If no safe TypeScript type-safety improvement exists, report that and make no edits.
