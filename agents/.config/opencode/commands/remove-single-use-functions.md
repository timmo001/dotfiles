---
description: Inline and remove safe single-use functions from current git scope
---

Follow current rules before making changes.
Follow local project rules while editing.
Do not assume ambiguous intent is clear; when ambiguity would change edits, ask one targeted question before changing code.
When user feedback conflicts with your assumption, treat user feedback as authoritative.

Read and apply the `remove-single-use-functions` rule before editing.

`BranchContextPlugin` injects a `<branch-context>` block before this command runs. Use its `Current Work Scope` sections as the primary scope source, and run git fallback commands only if the injected context is missing, stale, or insufficient.

1. Parse `Current Work Scope` in this order: unstaged, staged, then branch diff.

2. From files in scope (optionally narrowed by `${ARGUMENTS}`), find functions added or modified in the current work that are now used exactly once.

3. Apply the smallest safe cleanup that satisfies the `remove-single-use-functions` rule.

4. Run the smallest relevant verification for the touched code (targeted test, typecheck, lint, or build check).

5. Report briefly:
    - scope source used (plugin context or fallback)
    - functions removed
    - files changed
    - verification run + result

If no safe single-use function exists, report that and make no edits.
