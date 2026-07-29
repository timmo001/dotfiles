---
description: Review current branch work with the code-review skill and BranchContextPlugin context
agent: reviewer
---

Load the `code-review` skill before proceeding.
Load the `branch-context-consumer` skill. Use full-context mode.
Load the `changeset-scope` skill and apply its review boundary to every companion skill.
For changes in a codebase that does not use Effect, load `effect-principles` as review criteria regardless of programming language.

Have `branch-context-consumer` parse the injected `<work-scope>` in this order: unstaged changes, staged changes, then branch diff against the default branch. Resolve the final review boundary with `changeset-scope`, so narrower explicit user instructions still win.

Read full files when needed to verify behavior, not only diffs. Do not run additional `git` or `gh` commands unless the user explicitly asks for a fresh snapshot.

Report findings first, ordered by severity, with file paths and line numbers when possible. If no findings are discovered, say that explicitly and note residual testing or context gaps.
