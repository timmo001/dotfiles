---
name: writing-dot-skills
description: Craft for authoring skills that select reliably and stay lean - writing the description for correct auto-selection, matching instruction freedom to task fragility, deciding when to split into references or add scripts, and running quality and anti-pattern checks. Use when creating or revising a skill's content or structure. For the file schema, frontmatter fields, and placement, use customize-opencode.
---

# Writing dot skills

Craft guidance for writing and revising skills in this setup. It covers making a skill the agent selects at the right moment and that stays easy to scan.

For the mechanics - the `SKILL.md` frontmatter schema, valid fields, where skill files live, registration, and the restart-after-change rule - use the `customize-opencode` skill. This skill does not repeat them.

Lineage: adapted from mattpocock's `write-a-skill` and trailofbits' designing-workflow-skills, reworked for this repo and trimmed to the parts `customize-opencode` does not cover.

## Goals

- The agent selects the skill correctly from its description alone.
- `SKILL.md` stays short and practical.
- Supporting files earn their place by cutting repeated complexity.

## Workflow

1. Clarify the job.
   - State the task, the triggers, the scope, and any hard constraints.
   - Reuse the name this repo already uses for the workflow instead of inventing one.
2. Write the description for selection.
   - The description is the only thing the agent reads when deciding whether to load the skill. Everything else is read only after it activates.
   - Cover what the skill does and when to use it, and front-load the literal words, filenames, or request shapes that should trigger it.
   - Make it distinct from neighbouring skills so auto-selection is reliable, and gate with "Use ONLY when..." if it should stay quiet on adjacent topics.
   - Field format and required-field rules live in `customize-opencode`.
3. Draft the body.
   - Start with the minimum workflow that does the task well. Prefer direct rules and checklists over theory. Keep examples concrete and local.
   - Match instruction freedom to how fragile the task is:
     - Low freedom (exact commands) for fragile or destructive operations.
     - Medium freedom (templates with parameters) for preferred patterns where variation is fine.
     - High freedom (heuristics) for exploratory work like review or analysis.
   - Number multi-step phases so execution order is reliable.
4. Decide whether to split.
   - Keep `SKILL.md` self-contained by default.
   - Move detail into `references/` only when it is large, rarely needed, or a separate domain.
   - Keep every supporting file one hop from `SKILL.md`. No reference chains.
5. Decide whether to add scripts.
   - Add a script only for a deterministic operation the agent should not re-derive each run: validation, a fixed multi-step command, helper logic.
   - Document when to run the script instead of generating code freehand.
6. Wire it in.
   - Global skills live in `agents/.agents/skills/<name>/SKILL.md` and stow to `~/.agents/skills/`; run `dot stow` to link a new one.
   - If the skill changes a convention, update the relevant `AGENTS.md` in the same change, and run `dot agents-sync` when the global AGENTS source changed.
   - Global skills appear in the docs reference: run `mise run gen:opencode` in `docs/` and commit the regenerated `reference/skills.md`.
   - Confirm it loads with `dot opencode-debug`.

## Quality checks

Review against three severities:

- Critical (blocks loading or misfires): no `name` or `description`; broken paths to supporting files. See `customize-opencode` for the schema rules.
- Major (weak in practice): a vague description that will not trigger; a `SKILL.md` long enough that it should have been split; missing scope guidance on when to use it and when not to.
- Minor (polish): formatting and optional wording. Change these only when they genuinely improve how the agent behaves.

General checks:

- The description is specific enough for correct auto-selection and distinct from nearby skills.
- The workflow is short enough to scan.
- Supporting files exist only where they cut noise in `SKILL.md`.
- The skill matches current local tooling, paths, and names.
- No stale upstream or tool-specific instructions remain after adapting.

## Anti-patterns

- The description summarises the workflow instead of naming the triggers.
- A monolithic `SKILL.md` that should have moved detail into references.
- Reference chains, where one supporting file points to another. Keep everything one hop from `SKILL.md`.
- Instructions that assume a tool without naming it.
- Unnumbered steps in a multi-step workflow, so the order is ambiguous.
