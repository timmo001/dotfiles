---
description: List notes for the current repository, optionally filtered by tag
---

Load `notes-cli`, using `notes-list` as the context command. Reuse injected `<repo-note-context>` when available; otherwise obtain the current repository's listing through the CLI.

Treat `${ARGUMENTS}` as an optional case-insensitive tag filter. List matching notes newest-first with filename, name, description, tags, and modified time. Include the total, or say no notes match. Do not read note bodies or mutate notes.
