---
description: Research a topic from primary sources and compare evidence where judgement is involved
agent: researcher
---

Use this command for external primary-source research: gather docs, API, or spec facts, verify library or GitHub behaviour, or compare credible arguments and maintainer or contributor perspectives, then return cited findings.

Use `/investigate` instead for local triage and diagnosis, and `/explore-codebase` for internal codebase discovery.

Load and follow the `research` skill as the authoritative workflow.

Treat `${ARGUMENTS}` as the topic or question to research. If it is empty, use the current conversation context; if the target is still unclear, ask one question with the `question` tool to identify it.

Stay in research mode. End with cited findings, then offer `/note-create` or `/note-append` to keep them, and suggest `/plan` if the user wants to act on them.
