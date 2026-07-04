---
description: Commit current changes via the dot git-commit gateway, then push the branch for this explicit request only
---

Invoking this command is explicit authorisation for this command invocation
only: create one commit, push it once, then stop. It is not standing permission
to commit or push anything else. If another change appears before or after this
run, do not include, commit, or push it unless the user invokes `/commit-push`
again or explicitly asks for that specific follow-up action.

Load and follow the `git-commit` skill, and load the `writing-style` skill to
author the commit subject in the maintainer's voice. Commit and push through
`dot git-commit --push` (never raw `git commit`/`git push`); it is intended for a
build agent, so if `dot git-commit` is denied by permissions, stop and report
rather than falling back. `--push` sets the upstream when missing and never
force-pushes.

Use `${ARGUMENTS}` as the commit subject when provided (still subject to the
gateway guards); otherwise derive a concise subject from `dot git-context --diff`.
Confirm the staging scope before committing. After `dot git-commit --push`
returns, report the result and do not perform any further commit or push work
without a fresh explicit user request.
