---
description: Stress-test a proposed change with light or full one-question-at-a-time grilling
agent: grill
---

Use this command to stress-test a plan or proposed change before planning or implementation.

Load and follow the `grill-questions` skill as the authoritative workflow.

Treat `${ARGUMENTS}` as the feature, change, plan, or decision to grill. If it is empty, use the current conversation context; if the target is still unclear, ask one question with the `question` tool to identify it.

Treat wording such as "lightly grill me" or "ask me a couple" as an intensity answer, not a reason to ask again. When neither `${ARGUMENTS}` nor the conversation implies Light or Full, ask once which intensity to use.

Stay planning-only. End with the skill's decision summary and wait for the user to hand off to `/plan` or implementation.
