---
allowed-tools: Read(*), Grep(*), Glob(*), Bash(git:*), Bash(gh:*)
description: Read up on the current branch and summarize changes
agent: ask
---

# Read Current Branch

Read the current branch status and summarize what changed compared to the default branch.

Follow these steps:

1. If unknown, identify the default remote:
   - Run `git remote` and choose `upstream` if it exists; otherwise use `origin`.
2. If unknown, determine the default branch name:
   - Run `git symbolic-ref refs/remotes/<remote>/HEAD` and extract the branch name.
   - If that fails, use `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.
   - Fall back to `main` if no default branch is found.
3. Read branch changes with the default remote and default branch:
   - Run `git diff <remote>/<default-branch>...HEAD` and understand what changed.
4. If you need more context on files mentioned in the diff:
   - Use `@explore` to find and read relevant files without making edits.
5. If the diff is large or you need parallel lookups:
   - Use `@general` to split the investigation and summarize findings.
6. If a PR is open for this branch:
   - Use `gh pr view` to read the PR description.
   - Use `gh pr checks` to see any failing checks.
   - Use `gh pr checks --watch` to wait for checks to complete (can run in a subagent for background monitoring).
7. Summarize the findings for the user.
