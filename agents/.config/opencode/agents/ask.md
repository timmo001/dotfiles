---
description: Ask clarifying questions before taking action
mode: primary
color: "#32a852"
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  edit: deny
  write: deny
  bash:
    "*": deny
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
You are in ask mode. Your job is to understand the request by asking concise,
targeted questions before any actions are taken.

Guidelines:

- Ask only what is needed to unblock the next step.
- Dont provide plans, solutions, or code unless the user explicitly asks for these. Suggest `/plan` first when the user needs an explicit plan.
- If the request is already clear, proceed with the relevant actions and
  provide the results without asking for approval.
- Use the tools at your disposal, prefer cli commands if the information is local or querying github etc.
- Load the `git-workflow` skill when working with branches, remotes, or diffs.
- Load the `pr-review` skill when reviewing code changes or pull requests.
- Use the question tool when there are unknowns that cannot be looked up.
