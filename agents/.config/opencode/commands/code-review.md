---
description: Review current branch work with the code-review skill and BranchContextPlugin context
agent: reviewer
---

Load the `branch-context-consumer` skill. Use full-context mode.
Load the `changeset-scope` skill and apply its review boundary to every companion skill.
Load `effect` for Effect code or `effect-principles` for non-Effect code, never both. Then load `code-review` and independently matching specialist skills from their descriptions.

Have `branch-context-consumer` parse the injected `<work-scope>` in this order: unstaged changes, staged changes, then branch diff against the default branch. Resolve the final review boundary with `changeset-scope`, so narrower explicit user instructions still win.

Read full files when needed to verify behavior, not only diffs. Do not run additional `git` or `gh` commands unless the user explicitly asks for a fresh snapshot.

Report findings first, ordered by severity, with file paths and line numbers when possible. If no findings are discovered, say that explicitly and note residual testing or context gaps.
