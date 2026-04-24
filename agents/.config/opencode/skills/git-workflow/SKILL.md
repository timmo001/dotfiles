---
name: git-workflow
description: Patterns for working with git branches, remotes, and diffs against the default branch
---

# Git Workflow Patterns

Use this skill when working with branches, remotes, or comparing changes.

## Plugin-first branch context

`BranchContextPlugin` now precomputes branch context for `timmo001/read-branch`, `timmo001/reset-branch-reapply`, and `git-workflow` command executions. It injects a `<branch-context>` block containing:

- default remote/branch resolution
- branch status and commit list
- changed-file lists and diff stat
- patch output (`git diff <remote>/<default-branch>...HEAD`, truncated when large)
- PR metadata and check output when available

When `<branch-context>` is present:

1. Use it as the primary source for branch analysis.
2. Avoid re-running `git`/`gh` commands unless the user asks for a fresh snapshot.
3. Only execute fallback commands when context is missing or clearly stale.

## Fallback commands (only when needed)

If plugin context is unavailable, use this order:

1. `git remote` (prefer `upstream`, otherwise `origin`)
2. `git symbolic-ref refs/remotes/<remote>/HEAD`
3. `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`
4. `git diff <remote>/<default-branch>...HEAD`

```bash
git remote
git symbolic-ref refs/remotes/<remote>/HEAD
gh repo view --json defaultBranchRef -q .defaultBranchRef.name
git diff <remote>/<default-branch>...HEAD
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
gh pr checks --watch    # Watch for checks only when explicitly requested by the user
gh pr diff              # See what's in the PR
```

## Splitting a branch by changed files

Use this when a branch is too large and needs to be split into stacked branches with predictable file counts.

- Preferred helper script: `git-split-branch-by-files`
- Location: `~/.local/bin/git-split-branch-by-files`
- Naming: always `<source-branch>-b1`, `<source-branch>-b2`, and so on

Default behavior:

- Splits against `origin/HEAD` (fallback `dev`, `main`, then `master`)
- Creates 5 branches by default
- Makes the first 4 branches equal in changed-file count by default (`--equal-up-to 4`)
- Puts any remainder into the tail branches

Typical commands:

```bash
# Preview only
git-split-branch-by-files --source <branch> --base <base> --branches 5 --equal-up-to 4 --dry-run

# Recreate output branches if they already exist
git-split-branch-by-files --source <branch> --base <base> --branches 5 --equal-up-to 4 --force
```

Safety notes:

- Requires a clean worktree for real execution.
- Uses stacked output branches where each next branch is based on the previous split branch.
