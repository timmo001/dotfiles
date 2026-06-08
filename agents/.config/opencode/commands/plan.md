---
description: Manual entrypoint to native plan mode from the current conversation context
agent: plan
---

Use this command when the current task would benefit from an explicit plan before implementation and the user wants to start in planning mode explicitly.

Use `/grill` instead when the user wants an extended one-question-at-a-time design interview before a plan.

Some execution-oriented agents may also enter native plan mode automatically via `plan_enter`; this command is the manual entrypoint.

Follow these steps:

1. Use the existing conversation and any already-gathered repo context as the primary source of truth.
2. If `${ARGUMENTS}` is present, treat it as the specific planning target or refinement to focus on.
3. Do not restart discovery from scratch unless the current context is clearly missing a key detail.
4. Produce a concise implementation plan for the current task:
   - goal
   - scope
   - main steps
   - key risks, assumptions, or open questions
5. Ask only the minimum necessary follow-up questions to unblock a useful plan; do not run a grilling session from `/plan`.
6. Keep the output planning-focused; do not implement changes from this command.
7. End by stating that execution can continue after leaving plan mode.
