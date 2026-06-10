---
description: Stress-test a proposed change with one-question-at-a-time planning questions
agent: grill
---

Use this command to expand the question window before planning or implementation.

Load and follow the `grill-questions` skill as the authoritative workflow.

Treat `${ARGUMENTS}` as the feature, change, plan, or decision to grill. If it is empty, use the current conversation context; if the target is still unclear, ask one question with the `question` tool to identify it.

Stay planning-only. End with the skill's decision summary and readiness for `/plan` or implementation.
