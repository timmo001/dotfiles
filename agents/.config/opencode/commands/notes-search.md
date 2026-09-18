---
description: Search notes for the current repository by topic, keyword, or tag
---

Load `notes-cli`, using `notes-search` as the context command. Reuse injected `<repo-note-context>` when available; otherwise list the current repository's notes through the CLI.

Use `${ARGUMENTS}` as the query, falling back to a clear topic in the conversation. Rank matching names, descriptions, tags, and filenames by relevance. Return each matching filename, description, and a brief reason. Omit unrelated notes and report when none match.

Keep this a metadata search. Use `/note-reference` to load full notes; do not mutate them.
