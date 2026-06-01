---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
---

Write a handoff note summarising the current conversation so a fresh agent can continue the work. The note is stored in the repo notes vault alongside regular notes, using the `note_write` tool.

Configuration invariant: every primary agent should have access to the repo notes tools, especially `note_write`, so explicit handoff and note workflows are not blocked. Tool access does not imply autonomous note manipulation: use `note_read`, `note_write`, and `note_delete` only when a note command or skill instructs it, or when the user explicitly asks to create, update, read, or delete notes. Search-only or narrowly scoped subagents do not need notes access unless their workflow explicitly requires it.

## Output

Read `Notes path` from the `<repository>` section of the injected `<repo-note-context>`.

1. Generate a slug prefixed with `handoff-` (e.g. `handoff-auth-refactor`, `handoff-migrate-to-v4`).
2. Get the current full local timestamp with `date -Is`; use that exact value for `date:`.
3. Call the `note_write` tool with:
   - `path`: `{notes_path}/handoff-{slug}.md`
   - `content`: the full note content (see format below)

Do **not** use the `write`, `bash`, or any other tool to write the file — only `note_write`.

## Content guidelines

- Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.
- Redact any sensitive information, such as API keys, passwords, or personally identifiable information.
- If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
- If the conversation was trivial or too short to be worth a handoff, say so and ask the user if they still want to save it.

## Note format

```markdown
---
repo: {owner}/{repo}
branch: {branch}
date: {current `date -Is` value, e.g. 2026-06-01T14:30:00+01:00}
type: handoff
name: {Short human-readable title, 3–6 words, Title Case}
description: {One sentence describing the handoff purpose}
tags: [handoff, {2–4 additional kebab-case tags from the conversation}]
---

# {name}

## Summary

{2–4 sentence TLDR of what was accomplished this session}

## Next Focus

{What the next agent should pick up — the primary task, context needed, and any constraints. Derived from user arguments if provided, otherwise inferred from conversation state.}

## Suggested Skills

{Bullet list of skills the next agent should invoke, with a brief reason for each}

## Artifact References

{Bullet list of paths, URLs, commits, PRs, issues, or other artifacts relevant to the handoff. No content duplication — just pointers.}

## Open Threads

{Bullet list of unresolved items, or "(none)" if empty}
```

## Confirm

Tell the user exactly:

```
Saved: repo-notes/{owner}/{repo}/handoff-{slug}.md
```
