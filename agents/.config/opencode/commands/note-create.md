---
description: Create a new note for the current repository in your Obsidian notes vault
---

Load `notes-cli`, using `note-create` as the context command. Reuse injected `<repo-note-context>` when available.

Treat `${ARGUMENTS}` as the topic or focus; otherwise summarise the current conversation. Capture the useful facts, decisions and reasons, work completed, references, and unresolved questions. Omit empty sections.

Choose a descriptive kebab-case filename. Include YAML frontmatter with `repo` when resolved, `name`, `description`, and relevant block-style `tags`. Create the note through the skill's create workflow and report the actual saved path and any partial failure.
