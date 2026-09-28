---
description: Review current work or a pull request with the code-review skill in the read-only reviewer agent
agent: reviewer
---

Treat $ARGUMENTS as the review target: a pull request, branch, commit, or narrower instruction. With no target, review current work.

Load the `changeset-scope` skill and apply its review boundary to every companion skill.
Load `effect` for Effect code or `effect-principles` for non-Effect code, never both. Then load `code-review` and independently matching specialist skills from their descriptions.

Gather the scope yourself with `context git`, in this order: unstaged changes, staged changes, then the branch diff against the default branch. For a pull request, use `gh pr view` and `gh pr diff`. Narrower explicit user instructions still win.

Read full files when needed to verify behaviour, not only diffs.

Report findings first, ordered by severity, with file paths and line numbers when possible. If no findings are discovered, say that explicitly and note residual testing or context gaps.
