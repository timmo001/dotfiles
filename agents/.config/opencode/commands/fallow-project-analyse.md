---
description: Analyse a JavaScript or TypeScript project with Fallow
agent: ask
---

Load and apply the `fallow` skill before proceeding.

Prefer Fallow MCP tools over ad-hoc shell commands for this command.

Analyse the project or the scope named by `${ARGUMENTS}` with the most appropriate Fallow MCP tool. Default to broad project analysis rather than changed-file audit scope.

Use `${ARGUMENTS}` to narrow by workspace or package when the selected tool supports that scope.

Report findings first, ordered by severity or impact. If there are no findings, say that explicitly and summarize the tools or modes used. Do not edit files unless the user explicitly asks for fixes after the analysis step.
