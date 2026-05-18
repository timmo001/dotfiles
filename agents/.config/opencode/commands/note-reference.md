---
description: Load one or more notes for the current repository into context
---

A `<repo-note-context>` block has been injected above by RepoNotesPlugin. It contains:
- `<existing-notes>` — all note files with frontmatter (filename, name, description, tags, last modified)
- `<note-contents>` — full content of every note file, each wrapped in `<note file="…">…</note>`

The user's intent is in the message that invoked this command (e.g. "load the jwt auth note", "the ci pipeline one", "the last two notes").

Follow these steps exactly:

## Step 1: Check for notes

If `Notes directory exists: no` appears in the injected `<repository>` section, or `<existing-notes>` is empty, tell the user:

> No notes exist yet for `{owner}/{repo}`. Run `/note-create` to create the first note.

Do not proceed further.

## Step 2: Resolve which note(s) to load

Try to match the user's text against the notes in `<existing-notes>` using name, description, tags, and filename.

- **If the match is unambiguous** (one clear winner): proceed directly to Step 4.
- **If the text is ambiguous or matches multiple notes**: present a multi-select checkbox question using the `question` tool.

The question should look like:
> Which note(s) should be loaded into context?

List each option using the full label format:
```
filename — Name: Description [tags: a, b, c] (last modified: YYYY-MM-DD)
```

Wait for the user to confirm before continuing.

## Step 3: (If asked) Rank the options

If the user's text suggests a topic rather than a specific filename, rank the candidates by relevance using tags as primary signal, description as secondary, name as tertiary — then present the checkbox question from Step 2 with the ranked order.

## Step 4: Load the note(s)

For each selected note, find the matching `<note file="…">` block inside `<note-contents>` and hold its full content in context for this session.

Confirm to the user:

```
Loaded: repo-notes/{owner}/{repo}/{filename}
```

One line per loaded note. If multiple notes were loaded, list them all.

The content is now in context. Answer any follow-up questions about it directly.
