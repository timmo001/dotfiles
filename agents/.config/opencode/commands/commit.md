---
description: Split current changes into coherent commits via the dot git-commit gateway
---

This authorises commits, but not pushes, for the current requested changeset.
Load and follow `git-commit`, using the injected `<commit-context>` and
`${ARGUMENTS}` as optional grouping or subject guidance. Stop if the gateway is
unavailable; never fall back to raw Git commit commands.
