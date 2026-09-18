---
description: Keep documentation current with recent code changes, using the Context CLI
---

Load `maintain-docs` as the authoritative workflow, `context-cli` for repository snapshots, and `writing-style` before authoring any docs.

In this repository, also load the repo-local `dotfiles-docs` skill for the Blume site density, privacy, upstream-link, and generated-catalogue rules. Follow the Documentation section in the repo-root `AGENTS.md` as the short policy summary. Default is no hand-written docs update. Prefer short what-and-why pages; do not restore deleted runbooks, keybinding tables, or quirk detail. Only edit a hand-written page when a whole section's purpose changed. Generated catalogues still regenerate from source when those sources changed.

This flow edits docs and runs shell verification, so run it in an execution-capable agent with edit and verification permissions. If edits, writes, or required shell commands are denied by permissions, stop and report rather than falling back.

Treat `${ARGUMENTS}` as an optional focus (subsystem, path, or topic) and/or a `since` window (a date or relative duration such as "2 weeks ago"). If it is empty, use the default recent-commit window across the whole repo.

Bind the skill's steps to these tools:

- **Scope:** use `context git` for the recent-change map (commits and their changed files). Set `--since` to widen the window past the default, and add `--diff` or `--branch-diff` when you need the actual change contents. Do not rebuild this with separate `git status` or `git log` calls.
- **Investigate:** read the relevant code and docs, and verify external claims against primary sources.
- **External access:** the MCP tools this workflow needs must be available; if any are missing, stop. Decide access to external docs from the environment's advertised scope - the `<env>` workspace root and any `<available_references>` directories, with `opencode.json` permissions as one indicator, not a prerequisite. If an external docs location is outside that scope, halt and ask the user to widen scope (open a session in the parent directory, or add the reference) or grant access.
- **Verify:** run checks relevant to the documentation changes and any repository-required checks. Regenerate affected references; use docs builds and link validation when those surfaces are affected.

Preview the intended documentation updates before editing, write in-code and in-repo docs directly, and for gated external locations write in place or propose changes per the skill. Stop before commit: make no commit, push, or pull request. Report the skill's summary, and suggest `/plan` if the user wants to act on it further. If the recent changes only need generated-catalogue refresh or need no docs change at all, say so and stop without inventing prose.
