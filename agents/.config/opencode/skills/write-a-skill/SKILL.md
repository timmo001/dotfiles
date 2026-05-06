---
name: write-a-skill
description: Create new OpenCode skills with concise descriptions, clear triggers, and minimal supporting files. Use when adding or rewriting a local skill, command-adjacent skill, or reusable agent workflow.
---

# Write A Skill

Use this skill when creating or revising local OpenCode skills.

## Goals

- Make the skill easy for the agent to select correctly.
- Keep the main `SKILL.md` short and practical.
- Add supporting files or scripts only when they reduce repeated complexity.

## Workflow

1. Clarify the job the skill should do.
   - Define the task, triggers, scope, and any hard constraints.
   - Reuse existing local terminology when the repo already has a name for the workflow.
2. Write a strong description.
   - First sentence: what the skill does.
   - Second sentence: `Use when ...` with clear triggers, file types, or request shapes.
   - Make it distinct from nearby skills so auto-selection is reliable.
3. Draft the skill body.
   - Start with the minimum workflow needed to execute the task well.
   - Prefer direct rules and checklists over long theory.
   - Keep examples concrete and local when possible.
4. Decide whether to split.
   - Keep `SKILL.md` self-contained by default.
   - Split into references only when the detail is large, rarely needed, or has a separate domain.
5. Decide whether to add scripts.
   - Add scripts only for deterministic repeated operations, validation, or helper logic the agent should not re-derive each time.
   - If a script is added, document when it should be used instead of freeform generated code.
6. Check integration points.
   - If the skill changes local conventions, update related `AGENTS.md`, command docs, or wrapper commands in the same change.

## File Layout

```text
skill-name/
- SKILL.md
- REFERENCE.md        # optional
- EXAMPLES.md         # optional
- scripts/...         # optional
```

## Quality Checks

- The description is specific enough for correct auto-selection.
- The workflow is short enough to scan quickly.
- Supporting files exist only when they meaningfully reduce noise in `SKILL.md`.
- The skill matches current local tooling, paths, and naming.
- No stale upstream or tool-specific instructions remain after adaptation.
