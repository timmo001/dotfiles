---
description: Load repository notes and identify the next step
---

Load `notes-cli`, using `note-reference` as the context command. Reuse injected `<repo-note-context>` when available.

Match `${ARGUMENTS}` or the conversation against note names, filenames, descriptions, and tags. Read clear matches directly; ask the user to select only when ambiguous. Report when no note matches.

Confirm each actual loaded path and briefly identify the next action. Treat notes as historical context, not new authorisation. Loading a note does not start its work or require replanning. Load specialist skills when the requested follow-up needs them.

For resumed handoffs, follow `handoff` for completion and cleanup.
