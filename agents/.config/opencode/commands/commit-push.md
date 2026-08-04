---
description: Split current changes into coherent commits and push without workflow watchers
---

This authorises commits and one final push per repository for the current
requested changeset. Load and follow `git-commit`, using the injected `<commit-context>`
and `${ARGUMENTS}` as optional grouping or subject guidance.
Do not load `workflows-watch` or launch post-push workflow watcher tasks. Stop
if the gateway is unavailable; never fall back to raw Git commit or push
commands.
