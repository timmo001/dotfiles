---
description: Split current changes into coherent commits, push, then watch workflows
---

This authorises commits and one final push per repository for the current
requested changeset. Load and follow `git-commit` and `workflows-watch`, using
the injected `<commit-context>` and `${ARGUMENTS}` as optional grouping or
subject guidance. Stop if the gateway is unavailable; never fall back to raw
Git commit or push commands. Allow the workflow manifest's full two-minute
registration window before reporting that no workflow runs were found.
