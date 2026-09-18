---
description: Apply relevant TypeScript and cleanup skills in current git scope
---

Follow current instructions before making changes.
Follow local project guidance while editing.

Load `changeset-scope`, then `types-enforce-ts`. Select companion skills by their descriptions and the scoped code. Apply cleanup skills only when the changed code has relevant variables or helpers.

Load the `branch-context-consumer` skill. Use work-scope mode.

Use the injected `<work-scope>` as the refactor boundary. Use `${ARGUMENTS}` only to narrow that current-work scope.

Limit work to TypeScript files in scope (`.ts`, `.tsx`, `.mts`, `.cts`). Apply the smallest safe changes justified by the relevant skills.

Run the smallest relevant verification. Report the scope source used, TS skills applied, files changed, and verification result.

If no safe TypeScript skill improvement exists, report that and make no edits.
