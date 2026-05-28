---
description: List handoff notes for the current repository
---

A `<repo-note-context>` block has been injected above by RepoNotesPlugin. It contains the resolved `owner`, `repo`, `notes_path`, and the list of existing note files in `<existing-notes>`, sorted newest-first by modification time.

This is equivalent to `/notes-list handoff`. Follow the same steps as `/notes-list` but with the tag filter hardcoded to `handoff`.

## Step 1: Check for notes

If `Notes directory exists: no` appears in the injected `<repository>` section, or `<existing-notes>` contains "(notes directory does not exist yet)" or "(no .md files found in notes directory)", tell the user:

> No handoff notes exist yet for `{owner}/{repo}`. Run `/handoff` to create one.

Do not proceed further.

## Step 2: Filter by tag

Only include entries from `<existing-notes>` whose `[tags: ...]` field contains `handoff` (case-insensitive match).

If no entries match, tell the user:

> No handoff notes found for `{owner}/{repo}`. Run `/handoff` to create one.

Do not proceed further.

## Step 3: Display the list

Present the matching entries in order (newest-first — do not re-rank). Display them as a clean list, preserving the full label format:

```
filename — Name: Description [tags: a, b, c] (last modified: YYYY-MM-DD)
```

No question tool. No summaries. Just the list.
