---
description: Manages low-context delegated sessions through delivery
mode: primary
color: "#16a34a"
permission:
  "*": deny
  read: allow
  glob: allow
  grep: allow
  list: allow
  skill: allow
  question: allow
  todowrite: allow
  task: allow
  subagent: allow
  edit: deny
  write: deny
  bash:
    "*": ask
    "context git*": allow
    "context stack*": allow
    "notes context*": allow
    "notes list*": allow
    "notes read*": allow
    "notes delete*": ask
    "test *HERDR_ENV*": allow
    "printf *HERDR_ENV*": allow
    "test -x *": allow
    "command -v": allow
    "command -v *": allow
    "herdr *": allow
    "mise which *": allow
    "date -u": allow
    "date -u *": allow
    "pwd": allow
    "type -a *": allow
    "git *": ask
    "git blame*": allow
    "git branch": allow
    "git branch --show-current": allow
    "git branch -a": allow
    "git branch -r": allow
    "git branch -v": allow
    "git branch -vv": allow
    "git branch --list*": allow
    "git cat-file*": allow
    "git config --get*": allow
    "git config --list*": allow
    "git describe*": allow
    "git diff*": ask
    "git diff --check*": allow
    "git diff --name-only*": allow
    "git diff --name-status*": allow
    "git diff --numstat*": allow
    "git diff --shortstat*": allow
    "git diff --stat*": allow
    "git fetch*": allow
    "git for-each-ref*": allow
    "git log*": allow
    "git ls-files*": allow
    "git ls-tree*": allow
    "git merge-base*": allow
    "git name-rev*": allow
    "git reflog": allow
    "git reflog show*": allow
    "git remote": allow
    "git remote -v": allow
    "git remote get-url*": allow
    "git rev-parse*": allow
    "git shortlog*": allow
    "git show*": ask
    "git show --name-only*": allow
    "git show --name-status*": allow
    "git show --shortstat*": allow
    "git show --stat*": allow
    "git show --summary*": allow
    "git show-ref*": allow
    "git status*": allow
    "git tag": allow
    "git tag -l": allow
    "git tag --list*": allow
    "git worktree list*": allow
    "gh issue list*": allow
    "gh issue view*": allow
    "gh pr checks*": allow
    "gh pr diff*": ask
    "gh pr list*": allow
    "gh pr status*": allow
    "gh pr view*": allow
    "gh repo view*": allow
    "gh run view*": allow
    "gh stack *": ask
    "gh stack view --json": allow
    "dot git-commit*": ask
    "git commit": deny
    "git commit *": deny
  shell:
    "*": ask
    "test *HERDR_ENV*": allow
    "printf *HERDR_ENV*": allow
    "test -x *": allow
    "command -v": allow
    "command -v *": allow
    "herdr *": allow
    "mise which *": allow
    "date -u": allow
    "date -u *": allow
    "pwd": allow
    "type -a *": allow
    "git *": ask
    "git blame*": allow
    "git branch": allow
    "git branch --show-current": allow
    "git branch -a": allow
    "git branch -r": allow
    "git branch -v": allow
    "git branch -vv": allow
    "git branch --list*": allow
    "git cat-file*": allow
    "git config --get*": allow
    "git config --list*": allow
    "git describe*": allow
    "git diff*": ask
    "git diff --check*": allow
    "git diff --name-only*": allow
    "git diff --name-status*": allow
    "git diff --numstat*": allow
    "git diff --shortstat*": allow
    "git diff --stat*": allow
    "git fetch*": allow
    "git for-each-ref*": allow
    "git log*": allow
    "git ls-files*": allow
    "git ls-tree*": allow
    "git merge-base*": allow
    "git name-rev*": allow
    "git reflog": allow
    "git reflog show*": allow
    "git remote": allow
    "git remote -v": allow
    "git remote get-url*": allow
    "git rev-parse*": allow
    "git shortlog*": allow
    "git show*": ask
    "git show --name-only*": allow
    "git show --name-status*": allow
    "git show --shortstat*": allow
    "git show --stat*": allow
    "git show --summary*": allow
    "git show-ref*": allow
    "git status*": allow
    "git tag": allow
    "git tag -l": allow
    "git tag --list*": allow
    "git worktree list*": allow
    "gh issue list*": allow
    "gh issue view*": allow
    "gh pr checks*": allow
    "gh pr diff*": ask
    "gh pr list*": allow
    "gh pr status*": allow
    "gh pr view*": allow
    "gh repo view*": allow
    "gh run view*": allow
    "gh stack *": ask
    "gh stack view --json": allow
    "dot git-commit*": ask
    "git commit": deny
    "git commit *": deny
---

You coordinate delegated agent sessions.

Load and follow `session-coordination` before acting. It owns assignment,
asynchronous scheduling, concurrency caps, context rotation, live session state,
cleanup, approvals, optional independent review, and delivery. Load the additional
skills it routes to only when their branch applies.

Honour the user's explicit agent choice and keep runtime selection separate from
the profile selected inside that runtime. Prefer visible Herdr-managed sessions
for delegated work, including research. Use native child sessions only when
the user explicitly requests them. If Herdr is unavailable, report the limitation
rather than silently substituting native subagents. Apply `dotfiles-repositories`
for repository discovery and open-in-agent flows on this setup. It owns the shared
opener, alternate-runtime checks, and focus restoration; `session-coordination`
owns launch approval and worker lifecycle. Use the configured exact OpenCode 2
launcher. Use Pi or another Herdr-supported agent only when the user requests it.

Run each shell command as a separate tool call. Do not chain commands.

If `session-coordination` is unavailable, stop and report the missing skill. Do
not reconstruct its workflow in this agent prompt.
