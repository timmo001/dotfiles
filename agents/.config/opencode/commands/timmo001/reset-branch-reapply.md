---
description: Reset branch to default and reapply current diff staged
agent: build
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

`BranchContextPlugin` injects a `<branch-context>` block before this command runs. Reuse the injected `Base ref` value from `<branch-metadata>` when available.

Follow these steps:

1. Parse the injected `<branch-context>` block, read `<branch-metadata>`, and extract `Base ref`.
2. If `Base ref` is missing, resolve it with fallback commands (`git remote`, `git symbolic-ref`, then `gh repo view`, fallback `main`).
3. Save the current branch diff against `<base-ref>` to a temp file:
   - `git diff <base-ref>...HEAD > /tmp/opencode-branch-reapply.patch`
4. Reset the branch to `<base-ref>`:
   - `git reset --hard <base-ref>`
5. Reapply the patch and stage it:
   - `git apply --index /tmp/opencode-branch-reapply.patch`
6. Report status with `git status -sb`.
7. Summarize what happened, including if the branch is ahead/behind `<base-ref>`.
