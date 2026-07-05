---
name: maintain-docs
description: Keep documentation current and accurate with recent code changes, across in-code docs (docstrings, annotations, comments), in-repo docs sites, and external docs repositories. Use when asked to update docs, check docs accuracy, keep documentation current, document recent changes, refresh docstrings or annotations, or catch documentation up with the codebase. Matches the codebase's existing documentation density and stops before commit.
---

# Maintain docs

Keep documentation current and accurate as the codebase evolves. Cover recently changed subsystems with weak, stale, or inaccurate docs, public interfaces, workflows, operational runbooks, and setup or troubleshooting notes. This is authoring against verified behaviour, distinct from `/research` (external primary-source lookup) and `/explore-codebase` (internal discovery).

## Guardrails (always)

- Verify against source. Never document behaviour you have not confirmed in the code, never preserve claims that no longer match implementation, and never fabricate coverage.
- Match the codebase's existing documentation density and style, inferred from its agent instructions and existing code and docs. Shared, exported, or component-level surfaces get docs; single-use or self-explanatory internals do not. Do not introduce documentation conventions the codebase does not already use, such as docstrings in a codebase that avoids them or a new docs site where none exists.
- Prefer updating existing docs over adding redundant pages.
- Conform to the user's established writing style and voice: concise, human, house style, no robotic or marketing tone. Defer to any repo house style.
- Keep the change documentation-only and focused. Do not mix in unrelated code changes.
- Do not commit, push, or open a pull request.

## Quality checks

- Check doc mode fit before editing: tutorials teach, how-to guides complete a task, reference states facts, and explanations build understanding. Do not blur modes unless the existing docs deliberately do.
- Prefer current-state, timeless wording. Remove stale temporal framing such as "now", "new", "currently", "recently", "latest", or "soon" unless timing is the point of the doc.
- Test commands, setup steps, examples, and sample code where practical. If something cannot be run, say exactly what was verified instead.
- Remove or link duplicated procedures and repeated facts. Keep one source of truth and use cross-references when the docs already support them.
- Check audience and task fit: the page should make prerequisites clear and answer what the reader needs to do or understand next.

## Workflow

1. **Establish scope.** Take the set of recent changes from version-control history (the recent-commits window), widening it with a `since` date or ref when a broader catch-up is wanted. If given a focus (subsystem, path, or topic), narrow to it. Otherwise cover the whole recent window. Include existing documentation claims in scope when they describe the changed behaviour, not only missing or newly needed docs.
2. **Discover the surfaces.** Infer from the repo's own conventions which documentation surfaces apply to the changed areas: in-code docs (docstrings, annotations, comments), an in-repo docs site or design-doc build task, and documentation that lives in one or more external repositories. Read the repo's agent instructions, existing docs layout, comment density, doc-build tasks, and any references pointing to external docs. Identify both absent coverage and existing claims that may be stale, incomplete, misleading, or contradicted by the source. Only touch surfaces the codebase demonstrably uses.
3. **Investigate the changes.** For each changed area with a likely doc gap or accuracy risk, read the change and the relevant existing docs in detail before writing. Apply the quality checks above to the affected surfaces, not just presence/absence checks. Delegate independent areas to parallel read-only investigations where the environment supports it, choosing available subagents by their descriptions: local code and subsystem exploration, broad upstream dependency/source/docs reconnaissance, or cited external primary-source verification when a doc claim depends on library, API, spec, or GitHub behaviour. Synthesise the findings yourself.
4. **Gate external locations.** The required tools for this workflow (including any MCP tools) must be available; if they are not, stop and say so rather than degrading. Only edit documentation outside the current working directory when the location is within the environment's advertised accessible scope: the workspace roots plus any granted directories or references the harness surfaces. If an external docs location is outside that scope, halt and ask the user to widen scope (open or add the directory) or grant access, rather than guessing. Otherwise, read the external docs for context and propose changes instead of writing them.
5. **Preview, then write.** List the intended documentation updates (file, section, and why), including corrections to inaccurate existing claims and quality issues, before editing. Then write in-code and in-repo docs directly. For external locations that passed the gate, write in place; otherwise output the proposed changes for the user to apply.
6. **Verify.** Run the repo's own full lint and type checks, plus its documentation build and link validation. Regenerate any docs generated from source and check for drift instead of hand-editing generated pages. Report pre-existing, unrelated failures as pre-existing; do not fix out-of-scope code.
7. **Report and stop.** Stop before commit. Summarise what changed: docs added, updated, or corrected, the codepaths they cover, the key gaps or inaccuracies addressed, anything proposed but not written, and which repositories hold uncommitted doc changes. If no gaps or accuracy issues exist in scope, say the docs are already current and accurate, and make no edits.
