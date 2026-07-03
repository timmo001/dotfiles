---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
---

Write a handoff note summarising the current conversation so a fresh agent can continue the work. The note is stored in the repo notes vault alongside regular notes, using the note-writing tool (`dot_note_write` in OpenCode).

Configuration invariant: every primary agent should have access to the repo notes tools, especially the note-writing tool, so explicit handoff and note workflows are not blocked. Tool access does not imply autonomous note manipulation: use the note-read, note-write, and note-delete tools (`dot_note_read`, `dot_note_write`, `dot_note_delete` in OpenCode) only when a note command or skill instructs it, or when the user explicitly asks to create, update, read, or delete notes. Search-only or narrowly scoped subagents do not need notes access unless their workflow explicitly requires it.

## Output

Read `Notes path` from the `<repository>` section of the injected `<repo-note-context>`.

1. Generate a slug prefixed with `handoff-` (e.g. `handoff-auth-refactor`, `handoff-migrate-to-v4`).
2. Get the current full local timestamp with `date -Is`; use that exact value for `date:`.
3. Call the note-writing tool (`dot_note_write` in OpenCode) with:
   - `path`: `{notes_path}/handoff-{slug}.md`
   - `content`: the full note content (see format below)

Do **not** use the `write`, `bash`, or any other tool to write the file — only the note-writing tool.

## Multi-phase guard

Before writing a handoff, assess whether the work spans multiple logical phases that would each become a separate branch or PR (e.g. "phase 1: add schema, phase 2: migrate data, phase 3: update UI"). If so, **do not** create a single combined handoff. Instead:

1. Use the **question tool** to present choices:
   - **Create separate handoffs** (one per phase/branch) — recommended when reviewers benefit from smaller, isolated diffs.
   - **Create a single handoff anyway** — acceptable for personal projects or repos where large multi-phase branches are normal.
   - **Hand off only the first phase** — write a handoff for phase 1 only; the next agent can hand off subsequent phases when ready.
2. If the user picks separate handoffs, write one note per phase using the prefixed naming convention below.

**When reading an existing handoff** that describes multiple phases or a large multi-step plan spanning distinct concerns, suggest to the user that subsequent phases be handed off to separate branches. Offer the option to continue with the full plan as a last resort.

## Multi-phase naming convention

When creating handoffs that are part of a related group, use a **shared feature prefix** so they sort together when listed with `dot handoffs --list`:

- **Slug pattern:** `handoff-{feature}-{phase-slug}` — the shared prefix is the key grouping mechanism.
  - e.g. `handoff-query-params-calendar-api`, `handoff-query-params-voice-assistants`, `handoff-query-params-energy-navigation`
- **Numbered variant** (optional): add a number between feature and slug when execution order matters.
  - e.g. `handoff-gallery-1-component-shell`, `handoff-gallery-2-routing`, `handoff-gallery-3-descriptions`
- **Title pattern:** `"{Feature} Phase {N}: {Phase Title}"` for sequential work, or just a descriptive title for async/parallel work.

When to number:
- Phases depend on each other or have a natural execution order — number them.
- Phases are independent and can be worked in any order — skip numbering, the shared prefix is sufficient.

This ensures:
- `dot handoffs --list` groups related handoffs together alphabetically by feature prefix.
- Each handoff is independently actionable on its own branch.
- Numbered prefixes preserve execution order only when it matters.

## Content guidelines

- Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.
- Set `priority` to `low`, `medium`, `high`, or `critical` based on how urgently the next session should pick the work up. Handoffs without a priority are treated as `medium`.
- Redact any sensitive information, such as API keys, passwords, or personally identifiable information.
- If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
- If the conversation was trivial or too short to be worth a handoff, say so and ask the user if they still want to save it.

## Note format

```markdown
---
repo: {owner}/{repo}
date: {current `date -Is` value, e.g. 2026-06-01T14:30:00+01:00}
type: handoff
name: {Short human-readable title, 3–6 words, Title Case}
description: {One sentence describing the handoff purpose}
priority: {low | medium | high | critical, default medium}
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
