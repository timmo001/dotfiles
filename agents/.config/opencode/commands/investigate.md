---
description: Investigate a topic, issue, or area without editing by default
---

Use this command for general investigation, triage, and context-gathering tasks.

Use `/grill` instead when the user wants to stress-test a plan, decision, or idea through light or full question rounds.

Follow these steps:

1. Use `${ARGUMENTS}` as the topic, issue, question, or area to investigate.
2. If `${ARGUMENTS}` is empty or too vague to investigate safely, ask one concise question with the `question` tool to get the missing target.
3. Choose the right workflow for the request instead of forcing one tool path:
   - use the `diagnose` skill for concrete bug reports, regressions, flaky behaviour, or performance problems
   - use focused reads and searches for local codebase and upstream source inspection
   - use the `research` skill for external primary-source research that needs synthesis (docs, specs, APIs, library or GitHub behaviour)
   - investigate directly by default; prefer visible Herdr sessions for justified delegation and use native subagents only when explicitly requested
   - apply `browser-access` for browser-specific investigation, then use the authorised driver's tools
   - use `context7` tools for library/framework documentation lookups
   - use `grep` for GitHub-hosted docs or real-world code-pattern investigation
4. Prefer MCP tools over ad-hoc web or shell workflows when an appropriate MCP integration exists.
5. Do not edit files by default. Stay in investigation mode unless the user explicitly asks for changes.
6. Summarize the findings directly for the user:
   - what you checked
   - the most relevant evidence
   - the likely conclusion or next step
7. If the investigation is inconclusive, say what is still missing and the smallest next check that would reduce uncertainty.
