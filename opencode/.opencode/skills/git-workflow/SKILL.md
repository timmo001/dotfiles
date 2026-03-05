---
name: git-workflow
description: Patterns for working with git branches, remotes, and diffs against the default branch
---

# Git Workflow Patterns

Use this skill when working with branches, remotes, or comparing changes.

## Plugin-first branch context

`BranchContextPlugin` now precomputes branch context for `timmo001/read-branch` and `git-workflow` command executions. It injects a `<branch-context>` block containing:

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
gh pr checks --watch    # Watch for checks to complete (run in subagent for background monitoring)
gh pr diff              # See what's in the PR
```
