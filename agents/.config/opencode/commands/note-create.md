---
description: Create a new note for the current repository in your Obsidian notes vault
---

A `<repo-note-context>` block has been injected above by RepoNotesPlugin. It contains the resolved `owner`, `repo`, and `notes_path` for the current repository.

Use the `notes` CLI for vault operations. Resolve missing injected context with `notes context --json`.

Follow these steps exactly:

## Step 1: Summarise the conversation

Review the current conversation and write a structured summary that works as a durable reference for someone who wasn't present. Focus on substance: ideas, decisions, and reasoning, not just a log of actions.

Structure the summary into these sections:

- **Summary** — 2–4 sentence TLDR of what this session was about
- **Key Ideas** — The actual substance: concepts explored, approaches considered, insights reached
- **Decisions** — What was decided and why (include reasoning, not just the conclusion)
- **Actions Taken** — Files created, commands run, things built (brief reference list only)
- **Open Threads** — Anything unresolved, flagged for later, or worth revisiting

If the conversation was trivial or too short to be worth noting, say so and ask the user if they still want to save it.

## Step 2: Generate a topic slug

Auto-generate a kebab-case slug from the summary topic. Rules:

- Max 5 words
- Lowercase, hyphens only (no underscores, no special chars)
- Descriptive of the session topic, not generic (avoid: `session`, `notes`, `update`)
- Example: `auth-jwt-setup`, `refactor-nav-component`, `ci-pipeline-investigation`

## Step 3: Create the note

Read `Notes path` from the `<repository>` section of the injected context.

1. Generate the full note content using the format below.
2. Verify that `{notes_path}/{slug}.md` is unused with `notes list`.
3. Pass the full note content on stdin to `notes write --path "{notes_path}/{slug}.md" --stdin --json`.

The Notes CLI adds the frontmatter `date:` for you. Check its JSON result and report any save, commit, or push failure.

Use the Notes CLI rather than writing directly to the vault.

Use this exact format for `content`:

```markdown
---
repo: {owner}/{repo}
name: {Short human-readable title, 3–6 words, Title Case}
description: {One sentence describing what this note covers}
tags:
  - {kebab-case tag derived from the conversation}
  - {another tag, using 2–5 tags in total}
---

# {name value repeated here as the heading}

## Summary

{2–4 sentence TLDR}

## Key Ideas

{bullet list}

## Decisions

{bullet list with reasoning}

## Actions Taken

{brief bullet list}

## Open Threads

{bullet list, or "(none)" if empty}
```

## Step 4: Confirm

Tell the user exactly:

```text
Saved: repo-notes/{owner}/{repo}/{slug}.md
```
