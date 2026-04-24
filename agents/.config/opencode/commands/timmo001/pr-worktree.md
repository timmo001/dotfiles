---
description: Create a new git worktree and checkout a PR into it
project: home-assistant/frontend
agent: ask
---

Create a new git worktree from the dev branch and checkout the specified PR into it.

Steps:
1. Ask the user for the PR number if not provided
2. Get the PR branch name using: `gh pr view <PR_NUMBER> --json headRefName -q .headRefName`
3. Create a new worktree: `git worktree add ../frontend-<branch-name> -b <branch-name> dev`
   - If the branch already exists, use: `git worktree add ../frontend-<branch-name> <branch-name>`
4. Checkout the PR in the new worktree: `cd ../frontend-<branch-name> && gh pr checkout <PR_NUMBER>`
5. Change the current working directory to the new worktree: `cd ../frontend-<branch-name>`
6. Confirm the worktree was created, the PR is checked out, and the working directory has been changed

The worktree will be created in the parent directory with the name `frontend-<branch-name>` and will become the current working directory.
