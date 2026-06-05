---
description: General-style parallel subagent that researches with read-only tools and a narrow shell inspection allowlist (for delegation from read-only primaries).
mode: subagent
color: "#64748b"
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  skill: allow
  webfetch: allow
  websearch: allow
  question: deny
  plan_enter: deny
  plan_exit: deny
  edit: deny
  write: deny
  apply_patch: deny
  todowrite: deny
  bash:
    "*": deny
    "command -v*": allow
    "date*": allow
    "df*": allow
    "du*": allow
    "gh issue list*": allow
    "gh issue view*": allow
    "gh pr checks*": allow
    "gh pr diff*": allow
    "gh pr list*": allow
    "gh pr status*": allow
    "gh pr view*": allow
    "gh repo view*": allow
    "gh run view*": allow
    "git blame*": allow
    "git branch": allow
    "git branch --show-current": allow
    "git branch -a": allow
    "git branch -r": allow
    "git branch -v": allow
    "git branch -vv": allow
    "git branch --list*": allow
    "git cat-file*": allow
    "git describe*": allow
    "git diff*": allow
    "git log*": allow
    "git ls-files*": allow
    "git ls-tree*": allow
    "git remote": allow
    "git remote -v": allow
    "git remote get-url*": allow
    "git rev-parse*": allow
    "git shortlog*": allow
    "git show*": allow
    "git show-ref*": allow
    "git status*": allow
    "id": allow
    "ls*": allow
    "pwd": allow
    "stat*": allow
    "type*": allow
    "uname*": allow
    "uptime": allow
    "which*": allow
    "whoami": allow
  external_directory:
    "*": ask
---
You are a read-only general subagent: investigate, search, read files, and run only permitted inspection shell commands. Do not create, edit, patch, delete, move, or otherwise mutate project files. Return findings to the parent agent.
