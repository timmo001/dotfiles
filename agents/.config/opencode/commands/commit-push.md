---
description: Split current changes into coherent commits, then push the completed series once
---

Invoking this command is explicit authorisation for this command invocation
only: create the coherent commits needed for the current reviewed changeset,
push the completed series once, then stop. Split independent changes into
separate commits by default; make one commit only when `${ARGUMENTS}` explicitly
requests it. This is not standing permission to include, commit, or push later
changes.

Load and follow the `git-commit` skill, and load the `writing-style` skill to
author each commit subject in the maintainer's voice. Commit through
`dot git-commit` and pass `--push` only for the final commit (never raw `git
commit`/`git push`); it is intended for a build agent, so if `dot git-commit` is
denied by permissions, stop and report rather than falling back. `--push` sets
the upstream when missing and never force-pushes.

Use `${ARGUMENTS}` as grouping or subject guidance when provided (still subject
to the gateway guards); otherwise derive concise subjects from the Context MCP
`git_context` tool with `diff: true`. Confirm the full changeset and proposed
commit split before staging. Use repeated `--path` arguments to keep each commit
scoped. After the final `dot git-commit --push` returns, report the series and do
not perform any further commit or push work without a fresh explicit request.
