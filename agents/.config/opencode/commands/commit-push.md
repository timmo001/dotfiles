---
description: Commit current changes via the dot git-commit gateway, then push the branch
---

Invoking this command is explicit authorisation to create a commit and push it.

Load and follow the `git-commit` skill. Commit and push through
`dot git-commit --push` (never raw `git commit`/`git push`); it is intended for a
build agent, so if `dot git-commit` is denied by permissions, stop and report
rather than falling back. `--push` sets the upstream when missing and never
force-pushes.

Use `${ARGUMENTS}` as the commit subject when provided (still subject to the
gateway guards); otherwise derive a concise subject from `dot git-status --diff`.
Confirm the staging scope before committing.
