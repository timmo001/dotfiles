---
description: List all notes for the current repository
---

A `<repo-note-context>` block has been injected above by RepoNotesPlugin. It contains the resolved `owner`, `repo`, `notes_path`, and the list of existing note files in `<existing-notes>`, sorted newest-first by modification time.

Follow these steps exactly:

## Step 1: Check for notes

If `Notes directory exists: no` appears in the injected `<repository>` section, or `<existing-notes>` contains "(notes directory does not exist yet)" or "(no .md files found in notes directory)", tell the user:

> No notes exist yet for `{owner}/{repo}`. Run `/note-create` to create the first note.

Do not proceed further.

## Step 2: Display the list

Present all entries from `<existing-notes>` in order (newest-first — do not re-rank). Display them as a clean list, preserving the full label format:

```
filename — Name: Description [tags: a, b, c] (last modified: YYYY-MM-DD)
```

No question tool. No summaries. Just the list.
