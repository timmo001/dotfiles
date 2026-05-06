---
description: Investigate a topic, issue, or area without editing by default
agent: ask
---

Use this command for general investigation, triage, and context-gathering tasks.

Follow these steps:

1. Use `${ARGUMENTS}` as the topic, issue, question, or area to investigate.
2. If `${ARGUMENTS}` is empty or too vague to investigate safely, ask one concise question to get the missing target.
3. Choose the right workflow for the request instead of forcing one tool path:
   - use direct reads/searches for narrow repo lookups
   - use the `task` tool with `subagent_type: "explore"` for broad codebase discovery
   - use Chrome DevTools tools for browser-specific investigation
   - use Fallow MCP tools for JavaScript or TypeScript structural analysis
4. Do not edit files by default. Stay in investigation mode unless the user explicitly asks for changes.
5. Summarize the findings directly for the user:
   - what you checked
   - the most relevant evidence
   - the likely conclusion or next step
6. If the investigation is inconclusive, say what is still missing and the smallest next check that would reduce uncertainty.
