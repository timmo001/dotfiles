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
  task: deny
  "chrome-devtools_*": deny
  "chrome_devtools_*": deny
  cloudflare-api_execute: deny
  cloudflare-bindings_d1_database_create: deny
  cloudflare-bindings_d1_database_delete: deny
  cloudflare-bindings_d1_database_query: deny
  cloudflare-bindings_hyperdrive_config_delete: deny
  cloudflare-bindings_hyperdrive_config_edit: deny
  cloudflare-bindings_kv_namespace_create: deny
  cloudflare-bindings_kv_namespace_delete: deny
  cloudflare-bindings_kv_namespace_update: deny
  cloudflare-bindings_r2_bucket_create: deny
  cloudflare-bindings_r2_bucket_delete: deny
  convex_run: deny
  convex_envSet: deny
  convex_envRemove: deny
  "pitchfork_*": deny
  system-bridge_system_bridge_media_control: deny
  system-bridge_system_bridge_send_notification: deny
  question: deny
  plan_enter: deny
  plan_exit: deny
  edit: deny
  write: deny
  apply_patch: deny
  notes_note_write: deny
  notes_note_delete: deny
  todowrite: deny
  bash:
    "*": deny
    "timeout *": allow
    "command -v*": allow
    "ctx docs search*": allow
    "ctx docs show*": allow
    "ctx locate event*": allow
    "ctx locate session*": allow
    "ctx search*": allow
    "ctx show event*": allow
    "ctx show session*": allow
    "ctx sources*": allow
    "ctx sql*": allow
    "ctx status*": allow
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
    "gh release view*": allow
    "gh repo view*": allow
    "gh run view*": allow
    "gh run watch*": allow
    "gh search code*": allow
    "gh search commits*": allow
    "gh search issues*": allow
    "gh search prs*": allow
    "gh search repos*": allow
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
    "git fetch*": allow
    "git log*": allow
    "git ls-files*": allow
    "git ls-tree*": allow
    "git reflog*": allow
    "git remote": allow
    "git remote -v": allow
    "git remote get-url*": allow
    "git rev-parse*": allow
    "git shortlog*": allow
    "git show*": allow
    "git show-ref*": allow
    "git status*": allow
    "git symbolic-ref*": allow
    "git tag": allow
    "git tag -l": allow
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

Do not delegate to another agent. Complete the assigned work yourself and return it to the parent.

Prefer `Glob`, `Grep`, and `Read` for repository inspection. Do not use `head` or `tail` to trim small or normal command output; let normal output print in full. For genuinely huge output, search the saved content with `Grep` or read targeted sections with `Read` offsets.

If OpenCode reports `Full output saved to: ...`, inspect only targeted slices of that file. Do not read the full saved output into this subagent's context unless the parent explicitly asks for that.

Do not use Chrome DevTools tools for repository, command-output, CI, GitHub, or source-code research. They are only fit for browser-specific UI debugging, and this agent does not need them by default.
