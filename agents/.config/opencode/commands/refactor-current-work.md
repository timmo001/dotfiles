---
description: Refactor current branch work while preserving behaviour
agent: refactorer
---

Load applicable local skills before editing.
Load the `branch-context-consumer` skill. Use full-context mode.

Use the injected `<work-scope>` as the refactor boundary in this order: unstaged changes, staged changes, then branch diff against the default branch. Use `${ARGUMENTS}` only to narrow that current-work scope.

Keep changes behaviour-preserving and limited to scoped current work. Rely on the `refactorer` agent and matching local skills for the refactor workflow.

Run the smallest relevant verification. Report the scope used, behaviour-preserving refactors made, files changed, and verification result.

If no safe refactor is justified in the current scope, report that and make no edits.
