---
description: Refactor - enforce TypeScript type safety in current git scope
agent: refactorer
---

Load and apply the `types-enforce-ts` skill before editing.
Load the `branch-context-consumer` skill. Use work-scope mode.

Use the injected `<work-scope>` as the refactor boundary. Use `${ARGUMENTS}` only to narrow that current-work scope.

Find TypeScript edits in scope that weaken types or bypass type safety. Apply the smallest safe type fixes that satisfy the skill.

Run the smallest relevant verification. Report the scope source used, type issues fixed, files changed, and verification result.

If no safe TypeScript type-safety improvement exists, report that and make no edits.
