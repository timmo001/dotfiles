---
description: Split current changes into coherent commits, then push each repository series once
---

Invoking this command authorises commits and pushes only for changes clearly
required by the current user request and conversation. Push each completed
repository series once, then stop. Split related changes into coherent commits
by default; make one commit only when `${ARGUMENTS}` explicitly requests it.
This does not authorise unrelated session changes or later changes.

Load and follow the `git-commit` skill. Commit through `dot git-commit` and pass
`--push` only for the final commit (never raw `git commit`/`git push`); it is
intended for a build agent, so if `dot git-commit` is denied by permissions,
stop and report rather than falling back. `--push` sets the upstream when
missing and never force-pushes.

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
repositories relevant to the current request, run each gateway series from its
listed root, and pass `--push` only on that repository's final commit. After all
final pushes return, report the series and do not perform any further commit or
push work without a fresh explicit request.
