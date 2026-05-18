---
description: Search notes for the current repository by topic, keyword, or tag
---

A `<repo-note-context>` block has been injected above by RepoNotesPlugin. It contains the resolved `owner`, `repo`, `notes_path`, and the list of existing note files in `<existing-notes>` (filename, name, description, tags, last modified — no full note body).

The user's search query is in the message that invoked this command.

Follow these steps exactly:

## Step 1: Check for notes

If `Notes directory exists: no` appears in the injected `<repository>` section, or `<existing-notes>` contains "(notes directory does not exist yet)" or "(no .md files found in notes directory)", tell the user:

> No notes exist yet for `{owner}/{repo}`. Run `/note-create` to create the first note.

Do not proceed further.

## Step 2: Rank by relevance

Score every note in `<existing-notes>` against the user's query using these signals in order:

1. **Tags** — primary: tags that match or are semantically close to the query score highest
2. **Description** — secondary: semantic overlap with the query
3. **Name** — tertiary: title similarity

## Step 3: Return ranked results

Present the results as a ranked list, highest relevance first. For each entry include:

- The full label: `filename — Name: Description [tags: a, b, c] (last modified: YYYY-MM-DD)`
- One line explaining the relevance match (e.g. "tags `jwt`, `authentication` match directly")

Omit notes with no meaningful relevance to the query.

If no notes match, say so clearly and suggest `/notes-list` to browse all notes.

To load a note's full content into context, use `/note-reference`.
