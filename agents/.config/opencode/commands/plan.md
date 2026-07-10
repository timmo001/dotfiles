---
description: Manual entrypoint to native plan mode from the current conversation context
agent: plan
---

Use this command when the current task would benefit from an explicit plan before implementation and the user wants to start in planning mode explicitly.

Use `/grill` instead when the user wants light or full one-question-at-a-time stress-testing before a plan.

Some execution-oriented agents may also enter native plan mode automatically via `plan_enter`; this command is the manual entrypoint.

Use the existing conversation and already-gathered repo context as the primary source of truth. If `${ARGUMENTS}` is present, treat it as the planning target or refinement.

Load the `staged-implementation` skill and use it to decide whether the target is one coherent stage or several independently reviewable stages. Do not invent phases for a small change.

Produce a concise implementation plan with:

- Goal and scope.
- One active stage with its observable acceptance, contract owner where relevant, main steps, and validation order.
- A `Files` section containing the anticipated changed files as a directory tree, split by repository or workspace root.
- Deferred stages only when they are separate reviewable changes, including whether execution stops at their checkpoints or continues because the user requested one combined delivery.
- Key risks, assumptions, or open questions.

Ask only the minimum necessary follow-up questions to unblock a useful plan; do not run a grilling session from `/plan`.

Keep the output planning-focused and make no edits from this command. End by stating that execution can continue after leaving plan mode.
