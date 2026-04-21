---
description: Inline and remove unnecessary variables from current git scope
---

Follow current rules before making changes.
Follow local project rules while editing.
Do not assume ambiguous intent is clear; when ambiguity would change edits, ask one targeted question before changing code.
When user feedback conflicts with your assumption, treat user feedback as authoritative.

Read and apply the `cleanup-unnecessary-variables` rule before editing.

1. Build scope in this exact order:
   - unstaged changes (`git diff`)
   - staged changes (`git diff --cached`)
   - current branch diff from default branch (`git diff <default>...HEAD`) only when the current branch is not the default branch

2. Determine default branch from `origin/HEAD` when available; otherwise use the first existing fallback in: `dev`, `main`, `master`.

3. From files in scope (optionally narrowed by `${ARGUMENTS}`), find variables added or modified in the current work that are unnecessary and safe to remove.

4. Apply the smallest safe cleanup that satisfies the `cleanup-unnecessary-variables` rule.

5. Run the smallest relevant verification for the touched code (targeted test, typecheck, lint, or build check).

6. Report briefly:
    - git scope inspected (unstaged, staged, branch diff)
    - variables removed or inlined
    - files changed
    - verification run + result

If no safe unnecessary variable cleanup exists, report that and make no edits.
