---
description: Investigate a topic, issue, or area without editing by default
agent: ask
---

Use this command for general investigation, triage, and context-gathering tasks.

Use `/grill` instead when the user wants to stress-test a plan through extended one-question-at-a-time questioning.

Follow these steps:

1. Use `${ARGUMENTS}` as the topic, issue, question, or area to investigate.
2. If `${ARGUMENTS}` is empty or too vague to investigate safely, ask one concise question with the `question` tool to get the missing target.
3. Choose the right workflow for the request instead of forcing one tool path:
   - use the `diagnose` skill for concrete bug reports, regressions, flaky behaviour, or performance problems that need a reproducible feedback loop before fixing
   - use direct reads/searches for narrow local repo lookups
   - use the `task` tool with `subagent_type: "explore"` for broad codebase discovery
   - use Chrome DevTools tools for browser-specific investigation
   - use Fallow MCP tools for JavaScript or TypeScript structural analysis
   - use `context7` tools for library/framework documentation lookups
   - use `gh_grep` for GitHub-hosted docs or real-world code-pattern investigation
   - use Answer Overflow tools when community troubleshooting context is likely to help
4. Prefer MCP tools over ad-hoc web or shell workflows when an appropriate MCP integration exists.
5. Do not edit files by default. Stay in investigation mode unless the user explicitly asks for changes.
6. Summarize the findings directly for the user:
   - what you checked
   - the most relevant evidence
   - the likely conclusion or next step
7. If the investigation is inconclusive, say what is still missing and the smallest next check that would reduce uncertainty.
