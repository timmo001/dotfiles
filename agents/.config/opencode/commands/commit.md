---
description: Split current changes into coherent commits via the dot git-commit gateway
---

Invoking this command is explicit authorisation to create the coherent commits
needed for the current reviewed changeset. Split independent changes into
separate commits by default; make one commit only when `${ARGUMENTS}` explicitly
requests it. This does not authorise committing later changes or pushing.

Load and follow the `git-commit` skill, and load the `writing-style` skill to
author the commit subject in the maintainer's voice. Commit through
`dot git-commit` (never raw `git commit`); it is intended for a build agent, so
if `dot git-commit` is denied by permissions, stop and report rather than
falling back.

Use `${ARGUMENTS}` as grouping or subject guidance when provided (still subject
to the gateway guards); otherwise derive concise subjects from the Context MCP
`git_context` tool with `diff: true`. Confirm the full changeset and proposed
commit split before staging. Use repeated `--path` arguments to keep each commit
scoped, and do not push.
