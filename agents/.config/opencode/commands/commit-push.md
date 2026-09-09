---
description: Split current changes into coherent commits and push
---

This authorises commits and one final push per repository for the current
requested changeset. Load and follow `git-commit`, using the injected `<commit-context>`
and `${ARGUMENTS}` as optional grouping or subject guidance.
Stop after the push. If the gateway is unavailable, stop; never fall back to
raw Git commit or push commands.
