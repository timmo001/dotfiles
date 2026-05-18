---
name: improve-codebase-architecture
description: Review a codebase area for architectural friction and propose focused structural improvements. Use when the user wants to improve maintainability, reduce coupling, simplify understanding, or identify where code should be consolidated or deepened.
# origin: https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture
# upstream-sha: 7afa86d3a5dd96edde06ffa014e16c64e733681e
# local-edits:
#   - SKILL.md: condensed body, rewritten description, OpenCode tool references
#   - INTERFACE-DESIGN.md: Claude sub-agent spawning replaced with direct process
---

# Improve Codebase Architecture

Use this skill when the job is to review structure, not just clean up syntax or fix one bug.

## When to Use

- Architecture or maintainability review of a feature or subsystem
- Areas that feel over-abstracted, scattered, tightly coupled, or hard to test
- Follow-up after a bug or refactor when the deeper structural issue is still unclear

## When NOT to Use

- Small behaviour-preserving cleanup work
- Straightforward bug fixes with a clear local cause
- Broad codebase exploration with no structural question to answer

## What to Look For

Use the vocabulary from [LANGUAGE.md](references/LANGUAGE.md) -- module, interface, depth, seam, adapter, leverage, locality.

- Understanding one concept requires jumping across too many small files or layers
- Interfaces are nearly as complicated as the implementation behind them (shallow modules)
- Logic is split into helpers that reduce locality more than they reduce complexity
- Changes in one area require touching too many callers or adjacent modules
- The area is hard to test through its real interface

## Review Method

1. Start with the named area or subsystem, not the whole repo.
2. Read the most relevant local files first, then expand only as needed.
3. If the area is broad, use the `task` tool with `subagent_type: "explore"` to map the important files and relationships.
4. If glossary, ADR, or local architecture docs exist, use them to avoid proposing changes that fight established constraints.
5. Apply a simple deletion test:
   - if deleting the module would remove complexity, it may be unnecessary indirection
   - if deleting it would spread complexity back into many callers, it is likely earning its keep
6. Present a short list of candidate improvements, not one giant rewrite.

## Output Shape

For each candidate, include:

- files or modules involved
- current friction
- proposed structural change
- expected benefit for locality, clarity, or testability
- any obvious risk or tradeoff

## Plan Mode

This skill runs in **plan mode**. It produces analysis and recommendations only.

- Do NOT edit, write, or create any files.
- Do NOT implement any proposed changes.
- Present candidates and wait for the user to leave plan mode and accept before any implementation begins.
- If the user asks for edits during plan mode, remind them that implementation requires leaving plan mode first.

## Guardrails

- Prefer focused architectural improvements over speculative redesign.
- Do not assume glossary docs or ADRs exist.
- Do not force interface design in the first pass; identify the pressure points first.
- When the user picks a candidate to explore, use the [DEEPENING.md](references/DEEPENING.md) dependency categories to classify what the module depends on and determine testing strategy.
- When alternative interfaces are worth exploring, follow the [INTERFACE-DESIGN.md](references/INTERFACE-DESIGN.md) process (Design It Twice).
- Keep recommendations concrete enough to act on, but scoped enough to debate.
