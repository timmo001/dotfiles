---
description: Keep documentation current with recent code changes, via git-context and delegated investigation
---

Load the `maintain-docs` skill as the authoritative workflow, and load the `writing-style` skill alongside it before authoring any docs.

This flow edits docs, runs shell verification, and delegates to subagents, so run it in an execution-capable agent with edit and verification permissions. If edits, writes, or required shell commands are denied by permissions, stop and report rather than falling back.

Treat `${ARGUMENTS}` as an optional focus (subsystem, path, or topic) and/or a `since` window (a date or relative duration such as "2 weeks ago"). If it is empty, use the default recent-commit window across the whole repo.

Bind the skill's steps to these tools:

- **Scope:** run `context git` for the recent-change map (commits and their changed files). Pass `--since <date>` to widen the window past the default, and add `--diff` or `--branch-diff` when you need the actual change contents. Do not rebuild this with separate `git status` or `git log` calls.
- **Investigate:** delegate deep-dives with the `task` tool, in parallel where areas are independent. Choose from the available subagents by their descriptions: local code and subsystem exploration, broad read-only upstream dependency/source/docs reconnaissance, or cited external primary-source verification. Synthesise their findings yourself.
- **External access:** the MCP tools this workflow needs must be available; if any are missing, stop. Decide access to external docs from the environment's advertised scope - the `<env>` workspace root and any `<available_references>` directories, with `opencode.json` permissions as one indicator, not a prerequisite. If an external docs location is outside that scope, halt and ask the user to widen scope (open a session in the parent directory, or add the reference) or grant access.
- **Verify:** use the repo's own tasks (for example its mise, package, or make targets) for the full lint, type check, docs build, and link validation, and regenerate any generated docs.

Preview the intended documentation updates before editing, write in-code and in-repo docs directly, and for gated external locations write in place or propose changes per the skill. Stop before commit: make no commit, push, or pull request. Report the skill's summary, and suggest `/plan` if the user wants to act on it further.
