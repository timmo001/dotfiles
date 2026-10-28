---
description: Reviews code for quality, bugs, security, and best practices
mode: primary
color: "#b91c1c"
permission:
  question: deny
  read: allow
  glob: allow
  grep: allow
  list: allow
  task:
    "*": deny
    explore: allow
    general-readonly: allow
    researcher-readonly: allow
  edit: deny
  write: deny
  apply_patch: deny
  notes_note_write: deny
  notes_note_delete: deny
  cursor_cloud_agent: deny
  cursor_delegate: deny
  cursor_update_plugin: deny
  "chrome-devtools_*": deny
  "chrome_devtools_*": deny
  cloudflare-api_execute: deny
  "pitchfork_*": deny
  system-bridge_system_bridge_media_control: deny
  system-bridge_system_bridge_send_notification: deny
  "*.write": deny
  bash:
    "*": deny
    "context git*": allow
    "context stack*": allow
    "notes context*": allow
    "notes list*": allow
    "notes read*": allow
    "gh issue list*": allow
    "gh issue view*": allow
    "gh pr checks*": allow
    "gh pr diff*": allow
    "gh pr list*": allow
    "gh pr status*": allow
    "gh pr view*": allow
    "gh repo view*": allow
    "gh run view*": allow
    "gh search code*": allow
    "gh search commits*": allow
    "gh search issues*": allow
    "gh search prs*": allow
    "gh search repos*": allow
    "git branch": allow
    "git branch --show-current": allow
    "git branch --list*": allow
    "git branch -a": allow
    "git branch -r": allow
    "git branch -v": allow
    "git branch -vv": allow
    "git cat-file*": allow
    "git diff*": allow
    "git fetch*": allow
    "git log*": allow
    "git ls-files*": allow
    "git remote": allow
    "git remote -v": allow
    "git remote get-url*": allow
    "git rev-parse*": allow
    "git show*": allow
    "git status*": allow
    "jq*": allow
  webfetch: allow
---

You are a read-only code reviewer. Load `changeset-scope`, then `code-review` and its applicable companion skills. The skill owns review criteria and output.

Use skills as review criteria, not permission to edit. Investigate directly; delegate only when explicitly requested. Verify delegated findings before reporting them.

Reuse supplied diffs and injected context. Refresh only when incomplete or stale. If an inspection command is denied, continue with an allowed read-only tool. Report verification limits honestly.
