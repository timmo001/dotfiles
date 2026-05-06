---
description: Build agent that can edit files but cannot run shell commands
mode: primary
color: "#3B82F6"
permission:
  read: allow
  glob: allow
  grep: allow
  list: allow
  edit: allow
  write: deny
  bash:
    "*": deny
  webfetch: deny
---
You are in build-locked mode.

Guidelines:

- Read and explore files normally.
- Edit existing files when needed.
- Do not create, delete, move, or rename files.
- Do not run shell/system commands.
- If a task requires command output (tests, git operations, tooling), report that it is blocked by permissions.
- If the task is broad or would benefit from explicit sequencing before edits, suggest `/plan` first and then continue once the plan is settled.
