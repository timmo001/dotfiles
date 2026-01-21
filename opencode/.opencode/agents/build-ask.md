---
description: Build agent that asks before file writes
mode: primary
color: "#7393B3"
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  edit: ask
  write: ask
  bash:
    "*": ask
    "command -v*": allow
    "date*": allow
    "df*": allow
    "du*": allow
    "echo*": allow
    "gh issue list*": allow
    "gh issue view*": allow
    "gh pr checks*": allow
    "gh pr list*": allow
    "gh pr status*": allow
    "gh pr view*": allow
    "gh release view*": allow
    "gh repo view*": allow
    "git blame*": allow
    "git branch": allow
    "git branch --show-current": allow
    "git branch -a": allow
    "git branch -r": allow
    "git branch -v": allow
    "git branch -vv": allow
    "git cat-file*": allow
    "git describe*": allow
    "git diff*": allow
    "git fetch*": allow
    "git log*": allow
    "git ls-files": allow
    "git ls-tree*": allow
    "git reflog": allow
    "git remote": allow
    "git remote -v": allow
    "git rev-parse*": allow
    "git shortlog*": allow
    "git show*": allow
    "git show-ref*": allow
    "git status*": allow
    "git symbolic-ref*": allow
    "git tag": allow
    "git tag -l": allow
    "grep*": allow
    "head*": allow
    "id": allow
    "ls*": allow
    "pwd": allow
    "stat*": allow
    "tail*": allow
    "tree*": allow
    "type*": allow
    "uname*": allow
    "uptime": allow
    "which*": allow
    "whoami": allow
    "yarn lint*": allow
  webfetch: allow
---
