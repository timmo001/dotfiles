---
description: Explore a codebase topic with the task explore subagent
agent: ask
---

Use the `task` tool for this command instead of doing long serial searches yourself.

Follow these steps:

1. If `${ARGUMENTS}` is empty, ask one concise question to learn what area, feature, file family, or behavior the user wants explored.
2. Launch a `task` subagent with `subagent_type: "explore"`.
3. Treat `${ARGUMENTS}` as the exploration target and include clear return requirements in the subagent prompt:
   - what files or directories matter
   - what patterns or symbols to search for
   - whether the goal is architecture understanding, implementation lookup, or change-scope discovery
   - a concise final summary with the most relevant files and findings
4. Choose thoroughness based on the request:
   - quick for a narrow lookup in one area
   - medium for a feature or subsystem walkthrough
   - very thorough for broad architecture or cross-cutting behavior
5. For upstream or external repo exploration, prefer `gh_grep` for GitHub-hosted code patterns and `context7` for library/framework documentation instead of `webfetch` or `gh` CLI.
6. When the subagent returns, summarize the findings directly for the user instead of dumping raw subagent output.
7. Do not edit files unless the user explicitly asks for changes after the exploration step.
