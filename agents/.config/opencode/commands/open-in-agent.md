---
description: Open a local repository in an agent using its shared Herdr workspace
subagent: false
---

Treat $ARGUMENTS as the repository, optional agent runtime, and optional task brief.
Resolve the target from the conversation and repository registry; ask when the
repository or requested work is unclear. Default to the current runtime.

Load `dotfiles-repositories` for discovery and the shared launch workflow. Use
`session-coordination` when this is delegated work. Stay in the current profile.
This request authorises only the resolved launch and task; show the target and
runtime before opening it. Obtain evidence-backed agreement before adding workers
or locations beyond the request, and keep planning assignments read-only.

Report the repository, runtime, workspace and pane, whether the workspace was
reused or created, and whether the task brief was delivered or startup was blocked.
