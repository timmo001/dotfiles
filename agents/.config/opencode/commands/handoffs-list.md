---
description: List handoff notes for the current repository
---

Load `notes-cli`, using `handoffs-list` as the context command. Reuse injected `<repo-note-context>` when available; otherwise list the current repository's notes through the CLI.

Show only notes tagged `handoff`, newest-first, with filename, name, description, priority when present, and modified time. Include the total, or say no handoffs exist. Do not read note bodies or mutate notes.
