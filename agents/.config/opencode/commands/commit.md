---
description: Split current changes into coherent commits via the dot git-commit gateway
---

Invoking this command authorises commits only for changes clearly required by
the current user request and conversation. Split related changes into coherent
commits by default; make one commit only when `${ARGUMENTS}` explicitly requests
it. This does not authorise unrelated session changes, later changes, or pushing.

Load and follow the `git-commit` skill. Commit through `dot git-commit` (never
raw `git commit`); it is intended for a build agent, so if `dot git-commit` is
denied by permissions, stop and report rather than falling back.

Use `${ARGUMENTS}` as grouping or subject guidance when provided (still subject
to the gateway guards). The injected `<commit-context>` is attribution evidence,
not authorisation: candidate paths can include unrelated work from this session
tree. Filter every candidate against the current user request. Never commit a
path merely because it is listed, staged, session-touched, or forms a separate
coherent change. Exclude unrelated paths; if relevance is ambiguous, ask before
committing. A complete block means only that attribution collection succeeded.
Refresh with Context MCP `git_context` only when the block is absent, stale,
partial, or does not cover an explicitly requested repository. Never broaden
scope to the excluded dirty paths. Use repeated `--path` arguments to keep each
commit scoped. When several repository scopes are injected, operate only in
repositories relevant to the current request and run each gateway command from
its listed root. Do not push.
