---
description: Explore a codebase topic with the task explore subagent
agent: ask
---

Use the `task` tool for this command instead of doing long serial searches yourself.

Use `${ARGUMENTS}` as the exploration target. If it is empty, ask one concise question to learn what area, feature, file family, or behavior the user wants explored.

Launch a `task` subagent with `subagent_type: "explore"`, selecting quick, medium, or very thorough based on scope. Include clear return requirements: relevant files, patterns or symbols, exploration goal, and concise findings.

Summarize the subagent findings directly for the user. Do not edit files unless the user explicitly asks for changes after the exploration step.
