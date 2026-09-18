---
description: Append new notes to an existing note file for the current repository
---

Load `notes-cli`, using `note-append` as the context command. Reuse injected `<repo-note-context>` when available.

Resolve the target from `${ARGUMENTS}` and the conversation. Use an unambiguous selection directly; ask only when the target is unclear. If no notes exist, suggest `/note-create`.

Read the selected note and integrate only new information from this conversation into its existing structure. Preserve unrelated content and frontmatter. Save through the skill's revision-checked update workflow, then report the actual saved path and any partial failure.
