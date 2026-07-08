---
description: Review a codebase area for architectural friction and focused structural improvements
agent: plan
---

Use this command for architecture-focused investigation in a named area, feature, or subsystem.

Load and follow the `improve-codebase-architecture` skill as the primary review workflow for this command.

Use `${ARGUMENTS}` as the area, subsystem, feature, file family, or concern to review. If it is empty, ask one concise question with the `question` tool to learn what area to focus on.

Keep the work investigation and planning only. Make no file edits or code changes from this command. This command runs read-only: skip the skill's temp-directory HTML report and its inline domain-doc or decision-record updates. Deliver the candidate analysis in the conversation instead, and offer those side effects only as follow-ups the user can run after leaving plan mode.

Summarize the review with 2-4 focused candidate improvements, including files or modules involved, current friction, proposed structural change, expected benefit, and main tradeoff or risk. End by stating that implementation can continue only after leaving plan mode.
