---
description: Split current changes into coherent commits, then push each repository series once
---

This authorises commits and one final push per repository for the current
requested changeset. Load and follow `git-commit` and `workflows-watch`, using
the injected `<commit-context>` and `${ARGUMENTS}` as optional grouping or
subject guidance. Stop if the gateway is unavailable; never fall back to raw
Git commit or push commands.
