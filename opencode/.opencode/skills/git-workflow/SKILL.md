---
name: git-workflow
description: Patterns for working with git branches, remotes, and diffs against the default branch
---

# Git Workflow Patterns

Use this skill when working with branches, remotes, or comparing changes.

## Finding the Default Remote

1. Run `git remote` to list remotes
2. Prefer `upstream` if it exists, otherwise use `origin`

## Determining the Default Branch

Try these in order:

1. `git symbolic-ref refs/remotes/<remote>/HEAD` - extract branch name
2. `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`
3. Fall back to `main`

## Comparing Branch Changes

```bash
# See what changed on current branch vs default
git diff <remote>/<default-branch>...HEAD

# Save diff to file (useful for reapplying)
git diff <remote>/<default-branch>...HEAD > /tmp/branch.patch
```

## Resetting and Reapplying Changes

When you need to rebase or reset but preserve your changes:

1. Save the diff: `git diff <remote>/<default>...HEAD > /tmp/patch`
2. Reset: `git reset --hard <remote>/<default>`
3. Reapply staged: `git apply --index /tmp/patch`

## Checking PR Status

If a PR exists for the branch:

```bash
gh pr view              # Read description
gh pr checks            # Check CI status, find failing checks
gh pr checks --watch    # Watch for checks to complete (run in subagent for background monitoring)
gh pr diff              # See what's in the PR
```
