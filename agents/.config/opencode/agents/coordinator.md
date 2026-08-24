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
  notes_note_list: allow
  notes_note_read: allow
  notes_note_delete: allow
  context_git_context: allow
  edit:
    "*": deny
    "~/.cache/agent-coordinator/sessions/**": allow
  write:
    "*": deny
    "~/.cache/agent-coordinator/sessions/**": allow
  external_directory:
    "~/.cache/agent-coordinator/sessions/**": allow
  bash:
    "*": deny
    "test *HERDR_ENV*": allow
    "command -v": allow
    "command -v *": allow
    "herdr *": allow
    "mkdir -p ~/.cache/agent-coordinator/sessions": allow
    "rm -f ~/.cache/agent-coordinator/sessions/*.md": allow
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
    "*": deny
    "test *HERDR_ENV*": allow
    "command -v": allow
    "command -v *": allow
    "herdr *": allow
    "mkdir -p ~/.cache/agent-coordinator/sessions": allow
    "rm -f ~/.cache/agent-coordinator/sessions/*.md": allow
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
asynchronous scheduling, concurrency caps, context rotation, session records,
cleanup, approvals, review cycles, and delivery. Load the additional skills it
routes to only when their branch applies.

Honour the user's explicit agent choice. Otherwise use native child sessions,
which inherit the current OpenCode runtime. Use Pi or another Herdr-supported
agent only when the user requests it.

Run each shell command as a separate tool call. Do not chain commands.

If `session-coordination` is unavailable, stop and report the missing skill. Do
not reconstruct its workflow in this agent prompt.
