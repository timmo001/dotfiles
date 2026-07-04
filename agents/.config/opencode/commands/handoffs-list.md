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

Present the matching entries as a markdown table, newest-first:

| # | Name | Description | Tags | Modified |
|---|------|-------------|------|----------|
| 1 | {name} | {description} | `{tag1}`, `{tag2}` | {localised datetime} |

Rules:

- `#` column is a sequential row number
- `Name` is the frontmatter name (no bold, no filename)
- `Description` is the frontmatter description. Keep it readable — if it's over ~100 chars, truncate at a natural word boundary and append `...`, but if the full text is only a few words beyond that just include it all
- `Tags` uses inline code spans per tag, comma-separated
- `Modified` is the localised date and time from the injected note label
- After the table, list the filenames for reference and suggest next actions:

Files:

- `{filename1}`
- `{filename2}`

Use `/note-reference {filename}` to load a handoff, or `/handoff` to create a new one.

No question tool. No summaries beyond the table, file list, and next-action hint.
