---
description: Inline and remove safe single-use functions from current git scope
---

Follow current instructions before making changes.
Follow local project guidance while editing.
Do not assume ambiguous intent is clear; when ambiguity would change edits, ask one targeted question before changing code.
When user feedback conflicts with your assumption, treat user feedback as authoritative.

Load and apply the `remove-single-use-functions` skill before editing.

`BranchContextPlugin` must inject a `<branch-context>` block before this command runs. Use its `Current Work Scope` sections as the scope source.

1. Parse `Current Work Scope` in this order: unstaged, staged, then branch diff.

2. If `<branch-context>` is absent, do not run git fallback commands; stop and report that `BranchContextPlugin` did not inject context for this command.

3. From files in scope (optionally narrowed by `${ARGUMENTS}`), find functions added or modified in the current work that are now used exactly once.

4. Apply the smallest safe cleanup that satisfies the `remove-single-use-functions` skill.

5. Run the smallest relevant verification for the touched code (targeted test, typecheck, lint, or build check).

6. Report briefly:
    - scope source used (`BranchContextPlugin` context)
    - functions removed
    - files changed
    - verification run + result

If no safe single-use function exists, report that and make no edits.
