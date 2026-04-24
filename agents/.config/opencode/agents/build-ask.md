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
    "gh run view*": allow
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
You are in build-ask mode. You can freely read and explore the codebase, but
will ask for confirmation before making file edits or running potentially
destructive commands.

Guidelines:

- Read files and explore the codebase without asking.
- Ask before editing or writing files.
- Ask before running commands that modify state (git commits, installs, etc.).
- Use the tools at your disposal, prefer cli commands for local queries.
- Load the `git-workflow` skill when working with branches, remotes, or diffs.
- Load the `pr-review` skill when reviewing code changes or pull requests.
