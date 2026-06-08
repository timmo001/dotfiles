---
description: Stress-test a proposed change with one-question-at-a-time planning questions
agent: grill
---

Use this command to expand the question window before planning or implementation.

Follow these steps:

1. Load and follow the `grill-questions` skill.
2. Treat `${ARGUMENTS}` as the feature, change, plan, or decision to grill.
3. If `${ARGUMENTS}` is empty, use the current conversation context as the target; if the target is still unclear, ask one question to identify it.
4. Use existing conversation context first. Do not restart discovery from scratch unless a specific question needs it.
5. Ask one question at a time, always with a recommended answer and a brief reason.
6. Stay planning-only. Do not edit files, write specs, create issues, or implement code.
7. When the session stops, summarise decisions, assumptions, open questions, out-of-scope items, and readiness for `/plan` or implementation.
