---
description: Refactor - inline and remove safe single-use functions from current git scope
agent: refactorer
---

Load and apply the `remove-single-use-functions` skill before editing.
Load the `branch-context-consumer` skill. Use work-scope mode.

Use the injected `<work-scope>` as the refactor boundary. Use `${ARGUMENTS}` only to narrow that current-work scope.

Find functions added or modified in scope that are now used exactly once. Apply the smallest safe cleanup that satisfies the skill.

Run the smallest relevant verification. Report the scope source used, functions removed, files changed, and verification result.

If no safe single-use function exists, report that and make no edits.
