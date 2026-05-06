---
description: Analyse a JavaScript or TypeScript project with Fallow
agent: ask
---

Load and apply the `fallow` skill before proceeding.

Prefer Fallow MCP tools over ad-hoc shell commands for this command.

Follow these steps:

1. Analyse the project or the scope named by `${ARGUMENTS}` with Fallow using the most appropriate MCP tool for the request.
2. Default to broad project analysis rather than changed-file audit scope.
3. Include relevant deeper modes when useful, especially:
   - full dead-code analysis
   - health and complexity analysis
   - duplication detection
   - hotspots, targets, ownership, or score when they materially help explain the project state
4. If `${ARGUMENTS}` clearly names a workspace or package scope, use it to narrow the analysis when the selected tool supports that scope.
5. Report findings first, ordered by severity or impact.
6. If there are no findings, say that explicitly and summarize the tools or modes used.
7. Do not edit files unless the user explicitly asks for fixes after the analysis step.
