---
description: Append new notes to an existing note file for the current repository
---

A `<repo-note-context>` block has been injected above by RepoNotesPlugin. It contains the resolved `owner`, `repo`, `notes_path`, and the list of existing note files in `<existing-notes>`, sorted newest-first by modification time.

Follow these steps exactly:

## Step 1: Check for existing notes

If `notes_directory_exists: no` appears in the injected context, or `<existing-notes>` contains "(notes directory does not exist yet)" or "(no .md files found in notes directory)", stop and tell the user:

> No notes exist yet for `{owner}/{repo}`. Run `/note-create` to create the first note.

Do not proceed further.

## Step 2: Rank and present existing notes

1. Read the list from the `<existing-notes>` section (already sorted newest-first by modification time)
2. Using your understanding of the current conversation topic, re-rank the list by relevance — files most likely to be related to what was discussed should appear first
3. Present the ranked list to the user using the `question` tool — always show it even if the top match seems obvious

The question should look like:
> Which note should this session's content be appended to?

List each option as the filename (without path) and its last-modified date.

Wait for the user to select a file before continuing.

## Step 3: Summarise the conversation

Review the current conversation and write a structured update that captures new content from this session. Focus on what is new or changed — do not repeat content already in the existing note.

Write the update using the same section vocabulary as the existing note:
- **Key Ideas** — new concepts, insights, or approaches from this session
- **Decisions** — new decisions and their reasoning
- **Actions Taken** — new files, commands, or builds (brief list)
- **Open Threads** — new unresolved items or follow-ups

Omit any section that has no new content for this session.

## Step 4: Rewrite the note with integrated content

1. Read the full content of the selected note file
2. Integrate the new content into the appropriate sections:
   - Append new bullet items to existing sections (Key Ideas, Decisions, Actions Taken, Open Threads)
   - If a section in the existing note is missing but has new content, add it
   - Do not duplicate existing items
   - Do not change the frontmatter (repo, branch, date, tags) — those reflect the original session
3. Add a new `## Update — {YYYY-MM-DD}` section at the bottom of the file with a brief sentence summarising what this append session added (2–3 sentences max)
4. Write the complete updated file back to disk

## Step 5: Confirm

Tell the user exactly:

```
Updated: repo-notes/{owner}/{repo}/{filename}
```
