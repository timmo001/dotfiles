---
description: Manual entrypoint to native plan mode from the current conversation context
agent: plan
---

Use this command when the current task would benefit from an explicit plan before implementation and the user wants to start in planning mode explicitly.

Use `/grill` instead when the user wants light or full one-question-at-a-time stress-testing before a plan.

Some execution-oriented agents may also enter native plan mode automatically via `plan_enter`; this command is the manual entrypoint.

Use the existing conversation and already-gathered repository context as the primary source of truth. If `${ARGUMENTS}` is present, treat it as the planning target or refinement.

Load and follow the `plan` skill.
