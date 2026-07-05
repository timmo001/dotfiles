---
description: Commit current changes via the dot git-commit gateway in the maintainer's one-line style
---

Invoking this command is explicit authorisation to create one commit. It does
not authorise any later commit or push after another change, even in the same
session.

Load and follow the `git-commit` skill, and load the `writing-style` skill to
author the commit subject in the maintainer's voice. Commit through
`dot git-commit` (never raw `git commit`); it is intended for a build agent, so
if `dot git-commit` is denied by permissions, stop and report rather than
falling back.

Use `${ARGUMENTS}` as the commit subject when provided (still subject to the
gateway guards); otherwise derive a concise subject from `context git --diff`.
Confirm the staging scope before committing, and do not push.
