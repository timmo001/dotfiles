---
description: Reset branch to default and reapply current diff staged
agent: ask
permission:
  bash:
    "gh repo view*": allow
    "git apply --index*": allow
    "git diff*": allow
    "git remote": allow
    "git reset --hard*": allow
    "git status*": allow
    "git symbolic-ref*": allow
---

# Reset Branch And Reapply Diff

Drop all changes on the current branch and reapply the current branch diff on top of the default branch, staged.

Follow these steps:

1. Identify the default remote:
   - Run `git remote` and choose `upstream` if it exists; otherwise use `origin`.
2. Determine the default branch name:
   - Run `git symbolic-ref refs/remotes/<remote>/HEAD` and extract the branch name.
   - If that fails, use `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.
   - Fall back to `main` if no default branch is found.
3. Save the current branch diff against `<remote>/<default-branch>` to a temp file:
   - `git diff <remote>/<default-branch>...HEAD > /tmp/opencode-branch-reapply.patch`
4. Reset the branch to `<remote>/<default-branch>`:
   - `git reset --hard <remote>/<default-branch>`
5. Reapply the patch and stage it:
   - `git apply --index /tmp/opencode-branch-reapply.patch`
6. Report status with `git status -sb`.
7. Summarize what happened, including if the branch is ahead/behind.
