---
description: Write a handoff document for the next agent session
---

<repo-note-command>handoff</repo-note-command>

A `<repo-note-context>` block has been injected above by RepoNotesPlugin. It contains the resolved `owner`, `repo`, and `notes_path` for the current repository.

Load and follow the `handoff` skill for content and structure. Use the Notes CLI in place of its MCP tool references: `notes context --json`, `notes list`, `notes read --path <absolute-path> --json`, `notes write --path <absolute-path> --stdin --json`, and `notes delete`. Check a new path is unused; preserve existing content and use `--expected-hash` for updates. Confirm deletion with the user and report partial mutation failures.

Use `${ARGUMENTS}` as the focus description for the next session. If empty, derive the focus from the full conversation.
