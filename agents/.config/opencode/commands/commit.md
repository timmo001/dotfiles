---
description: Split current changes into coherent commits via the dot git-commit gateway
---

Invoking this command is explicit authorisation to create the coherent commits
needed for the current reviewed changeset. Split independent changes into
separate commits by default; make one commit only when `${ARGUMENTS}` explicitly
requests it. This does not authorise committing later changes or pushing.

Load and follow the `git-commit` skill. Commit through `dot git-commit` (never
raw `git commit`); it is intended for a build agent, so if `dot git-commit` is
denied by permissions, stop and report rather than falling back.

Use `${ARGUMENTS}` as grouping or subject guidance when provided (still subject
to the gateway guards). Use the injected `<commit-context>` as the scope and
diff evidence. When it is complete and unambiguous, proceed without another
context read or staging announcement. Refresh with Context MCP `git_context`
only when the block is absent, stale, partial, or does not cover an explicitly
requested repository. Never broaden scope to the excluded dirty paths. Use
repeated `--path` arguments to keep each commit scoped. When several repository
scopes are injected, run each gateway command from its listed root. Do not push.
