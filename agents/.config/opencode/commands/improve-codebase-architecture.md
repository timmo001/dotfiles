---
description: Review a codebase area for architectural friction and focused structural improvements
agent: plan
---

Use this command for architecture-focused investigation in a named area, feature, or subsystem.

Load and follow the `improve-codebase-architecture` skill as the primary review workflow for this command.

Follow these steps:

1. Use `${ARGUMENTS}` as the area, subsystem, feature, file family, or concern to review.
2. If `${ARGUMENTS}` is empty, ask one concise question to learn what area to focus on.
3. Load the `improve-codebase-architecture` skill and keep its review method as the default approach for the rest of this command.
4. Keep the work investigation and planning only. Do NOT make any file edits or code changes.
5. Start narrow in the named area, then expand only as needed to understand relationships.
6. If the area is broad or cross-cutting, use the `task` tool with `subagent_type: "explore"` and ask for:
   - the key files and modules in scope
   - the current structural relationships
   - the most likely architectural friction points
   - a concise final summary
7. Summarize the review directly for the user with a short candidate list:
   - files or modules involved
   - current friction
   - proposed structural change
   - expected benefit
   - main tradeoff or risk
8. Do not propose a full rewrite by default; prefer 2-4 focused candidate improvements.
9. End by stating that no edits will be made in plan mode; the user must leave plan mode and accept the plan before implementation begins.
