---
name: git-context
description: Patterns for working with git branches, remotes, diffs against the default branch, and rebases. Use when resolving rebase conflicts, continuing interactive rebases, amending commits, or any git operation that would open an interactive editor.
---

# Git Context Patterns

Use this skill when working with branches, remotes, or comparing changes.

## Plugin-first branch context

`BranchContextPlugin` precomputes branch and scoped-work context for branch-oriented commands and scoped cleanup/type commands. It injects a `<branch-context>` block with tagged sections:

- `<branch-metadata>` for default remote/branch resolution and base-ref identity
- `<status>` for compact `git status -sb` output
- `<work-scope>` for current work scope in this order: unstaged, staged, then branch diff
- `<pull-request>` for PR metadata and check output on branch-focused commands when available
- `<warnings>` for collection caveats, fallbacks, and missing data

When `<branch-context>` is present:

1. Use it as the primary source for branch analysis.
2. Use `<work-scope>` instead of rebuilding scope with separate git commands.
3. Avoid re-running `git`/`gh` commands unless the user asks for a fresh snapshot.
4. For commands that require `BranchContextPlugin` scope, stop and report a plugin issue if context is missing instead of rebuilding scope.

## MCP refresh and fallback commands

If plugin context is unavailable or stale during ad-hoc work that is not plugin-backed, use the Context MCP server's `git_context` tool. In OpenCode this is exposed as `context_git_context`. Request `diff: true`, `branchDiff: true`, `since`, or PR details only when the task needs them.

If the MCP tool is unavailable and you need a scoped work snapshot, use this fallback order:

1. `git diff`
2. `git diff --cached`
3. `git remote` (prefer `upstream`, otherwise `origin`)
4. `git symbolic-ref refs/remotes/<remote>/HEAD`
5. `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`
6. `git diff <remote>/<default-branch>...HEAD` when not on the default branch

```bash
git diff
git diff --cached
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
gh pr checks --watch    # Watch checks when the task requires waiting for CI
gh pr diff              # See what's in the PR
```

For long-running GitHub Actions waits, prefer compact `gh` watches over repeated GitHub MCP polling when available. Check `gh run watch --help` or `gh pr checks --help` first; this setup supports `gh run watch <run-id> --compact --exit-status --interval <seconds>` and `gh pr checks --watch`. Do not use `gh run view --watch` unless the installed CLI documents it.

## Rebases and Interactive Editor Operations

Git opens an interactive editor for many operations. Since the agent runs in a non-interactive shell, bypass the editor with `GIT_EDITOR=true` (which makes the "editor" succeed immediately, accepting defaults).

### Commands that need `GIT_EDITOR=true`

```bash
GIT_EDITOR=true git rebase --continue   # After resolving conflicts
GIT_EDITOR=true git merge --continue    # After resolving merge conflicts
GIT_EDITOR=true git revert --continue   # After resolving revert conflicts
```

For any requested commit amendment, load `git-commit` and use its `dot git-commit --amend` gateway flow instead of raw `git commit --amend`.

### Resolving rebase conflicts

1. Read each conflicted file and understand both sides.
2. When both sides are additive (independent features touching the same location), keep both.
3. After replacing conflict markers, verify full method/function bodies are intact — shared code between conflict markers is easily lost if not carefully included in the resolution.
4. Stage resolved files with `git add`.
5. Continue with `GIT_EDITOR=true git rebase --continue`.

### Operations that do NOT need the editor bypass

- `git rebase --abort` / `git merge --abort` (no editor involved)
- `git rebase --skip` (no editor involved)

Ordinary commits are outside this skill. Load `git-commit` after an explicit commit request and use its gateway.

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
