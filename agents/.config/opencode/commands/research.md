---
description: Research a topic against primary sources and return cited findings
agent: researcher
---

Use this command for external primary-source research: gather docs, API, or spec facts and verify library or GitHub behaviour, then return findings with every claim cited.

Use `/investigate` instead for local triage and diagnosis, and `/explore-codebase` for internal codebase discovery.

Load and follow the `research` skill as the authoritative workflow.

For broad upstream dependency, source, or documentation reading, the researcher may delegate read-only legwork to an available subagent whose description matches that work. The researcher still owns source ranking, claim verification, and the final cited synthesis.

Treat `${ARGUMENTS}` as the topic or question to research. If it is empty, use the current conversation context; if the target is still unclear, ask one question with the `question` tool to identify it.

Stay in research mode. End with cited findings, then offer `/note-create` or `/note-append` to keep them, and suggest `/plan` if the user wants to act on them.
