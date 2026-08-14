---
description: Stress-test a plan, decision, or idea with light or full question rounds
agent: grill
---

Use this command to stress-test a plan, decision, or idea before planning or implementation.

Load and follow the `grilling` skill as the authoritative workflow.

Treat `${ARGUMENTS}` as the target to grill. If it is empty, use the current conversation context; if the target remains unclear, ask one question with the `question` tool to identify it.

Treat wording such as "lightly grill me" or "ask me a couple" as an intensity answer. When neither `${ARGUMENTS}` nor the conversation implies Light or Full, ask once which intensity to use.

Stay planning-only. Ask no more than five dependency-ready material questions per question-tool call. When the frontier is larger, prioritise five and continue the remainder in later rounds. Then end with the skill's decision summary and wait for the user to hand off to `/plan` or implementation.
