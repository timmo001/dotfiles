---
name: cloud-rebase
description: Finish rebasing distro/cloud onto distro/ubuntu-server when the Cloud rebase workflow could not do it alone. Use when its "Rebase distro/cloud onto the server branch" issue is open, or when asked to rebase or update the cloud branch from the server branch.
---

# Cloud Rebase

The Cloud rebase workflow force-pushes a clean rebase by itself. It opens or updates one issue when the rebase conflicts, the server added files, or the checks failed, and pushes nothing.

1. Read the open issue: `gh issue list --search 'in:title "Rebase distro/cloud"'`, then `gh issue view <number>`.
2. On a checkout of `distro/cloud` with a clean working tree, follow "Updating From The Server Branch" in `AGENTS.md`. The issue's lists of incoming commits, conflicts and added files are the look-ahead done for you.
3. Ask the user about any change you can't sort into wanted or not wanted from those rules. Don't guess.
4. Run the checks under Validation in `AGENTS.md`. When the rebase touched `cloud/` or `dot cloud setup`, also run `HOME=$(mktemp -d) bash cloud/setup.sh --ref <branch>` from a pushed branch. Then push with `git push --force-with-lease`. This is the one push the skill may make without being asked, since the issue is the request.
5. Close the issue with a comment naming the server commit you rebased onto and anything you dropped or adapted.
