---
description: Split current changes into coherent commits, then push each repository series once
---

Invoking this command is explicit authorisation for this command invocation
only: create the coherent commits needed for the current reviewed changeset,
push each completed repository series once, then stop. Split independent changes into
separate commits by default; make one commit only when `${ARGUMENTS}` explicitly
requests it. This is not standing permission to include, commit, or push later
changes.

Load and follow the `git-commit` skill. Commit through `dot git-commit` and pass
`--push` only for the final commit (never raw `git commit`/`git push`); it is
intended for a build agent, so if `dot git-commit` is denied by permissions,
stop and report rather than falling back. `--push` sets the upstream when
missing and never force-pushes.

Use `${ARGUMENTS}` as grouping or subject guidance when provided (still subject
to the gateway guards). Use the injected `<commit-context>` as the scope and
diff evidence. When it is complete and unambiguous, proceed without another
context read or staging announcement. Refresh with Context MCP `git_context`
only when the block is absent, stale, partial, or does not cover an explicitly
requested repository. Never broaden scope to the excluded dirty paths. Use
repeated `--path` arguments to keep each commit scoped. When several repository
scopes are injected, run each gateway series from its listed root and pass
`--push` only on that repository's final commit. After all final pushes return,
report the series and do not perform any further commit or push work without a
fresh explicit request.
