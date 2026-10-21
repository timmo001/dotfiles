---
name: server-rebase
description: Finish rebasing distro/ubuntu-server onto distro/arch-omarchy-quattro when the Server rebase workflow could not do it alone. Use when its "Rebase distro/ubuntu-server onto the desktop branch" issue is open, or when asked to rebase or update the server branch from the desktop branch.
---

# Server Rebase

The Server rebase workflow force-pushes a clean rebase by itself. It opens or updates one issue when the rebase conflicts, the desktop added files, or the checks failed, and pushes nothing.

1. Read the open issue: `gh issue list --search 'in:title "Rebase distro/ubuntu-server"'`, then `gh issue view <number>`.
2. On a checkout of `distro/ubuntu-server` with a clean working tree, follow "Updating From The Desktop Branch" in `AGENTS.md`. The issue's lists of incoming commits, conflicts and added files are step 1 and step 6 done for you.
3. Ask the user about any change you can't sort into wanted or not wanted from those rules. Don't guess.
4. Run the checks under Validation in `AGENTS.md`, then push with `git push --force-with-lease`. This is the one push the skill may make without being asked, since the issue is the request.
5. Close the issue with a comment naming the desktop commit you rebased onto and anything you dropped or adapted.
6. The push starts the Cloud rebase workflow for `distro/cloud`. Mention any open "Rebase distro/cloud onto the server branch" issue it leaves, but don't work on it here.
