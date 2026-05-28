---
description: List notes for the current repository, optionally filtered by tag
---

A `<repo-note-context>` block has been injected above by RepoNotesPlugin. It contains the resolved `owner`, `repo`, `notes_path`, and the list of existing note files in `<existing-notes>`, sorted newest-first by modification time.

Follow these steps exactly:

## Step 1: Check for notes

If `Notes directory exists: no` appears in the injected `<repository>` section, or `<existing-notes>` contains "(notes directory does not exist yet)" or "(no .md files found in notes directory)", tell the user:

> No notes exist yet for `{owner}/{repo}`. Run `/note-create` to create the first note.

Do not proceed further.

## Step 2: Filter by tag (if provided)

If `${ARGUMENTS}` is non-empty, treat it as a tag filter. Only include entries from `<existing-notes>` whose `[tags: ...]` field contains the specified tag (case-insensitive match).

If no entries match the filter, tell the user:

> No notes tagged `{tag}` found for `{owner}/{repo}`.

Do not proceed further.

If `${ARGUMENTS}` is empty, include all entries.

## Step 3: Display the list

Present the matching entries as a markdown table, newest-first:

| # | Name | Description | Tags | Modified |
|---|------|-------------|------|----------|
| 1 | {name} | {description} | `{tag1}`, `{tag2}` | {YYYY-MM-DD} |

Rules:
- `#` column is a sequential row number
- `Name` is the frontmatter name (no bold, no filename)
- `Description` is the frontmatter description. Keep it readable — if it's over ~100 chars, truncate at a natural word boundary and append `...`, but if the full text is only a few words beyond that just include it all
- `Tags` uses inline code spans per tag, comma-separated
- `Modified` is the YYYY-MM-DD date
- After the table, list the filenames for reference and suggest next actions:

Files:
- `{filename1}`
- `{filename2}`

Use `/note-reference {filename}` to read a note, or `/note-append {filename}` to add to one.

No question tool. No summaries beyond the table, file list, and next-action hint.
