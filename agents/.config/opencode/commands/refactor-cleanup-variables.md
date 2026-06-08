---
description: Refactor - inline and remove unnecessary variables from current git scope
agent: refactorer
---

Load and apply the `cleanup-unnecessary-variables` skill before editing.
Load the `branch-context-consumer` skill. Use work-scope mode.

Use the injected `<work-scope>` as the refactor boundary. Use `${ARGUMENTS}` only to narrow that current-work scope.

Find variables added or modified in scope that are unnecessary and safe to remove. Apply the smallest safe cleanup that satisfies the skill.

Run the smallest relevant verification. Report the scope source used, variables removed or inlined, files changed, and verification result.

If no safe unnecessary variable cleanup exists, report that and make no edits.
