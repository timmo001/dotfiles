---
description: Inline and remove safe single-use functions from current git scope
---

Follow current rules before making changes.
Follow local project rules while editing.
Do not assume ambiguous intent is clear; when ambiguity would change edits, ask one targeted question before changing code.
When user feedback conflicts with your assumption, treat user feedback as authoritative.

1. Build scope in this exact order:
   - unstaged changes (`git diff`)
   - staged changes (`git diff --cached`)
   - current branch diff from default branch (`git diff <default>...HEAD`) only when the current branch is not the default branch

2. Determine default branch from `origin/HEAD` when available; otherwise use the first existing fallback in: `dev`, `main`, `master`.

3. From files in scope (optionally narrowed by `${ARGUMENTS}`), find functions added or modified in the current work that are now used exactly once.

4. For each candidate, run this pre-check list before editing:
   - Must be local and non-exported.
   - Must have exactly one real call site after the current change set is applied.
   - Skip public APIs, framework hooks, callbacks, overloaded/generic utilities, and test helpers kept for readability.

5. Inline every candidate that passes the pre-check list at its sole call site, then remove the original function definition.
   Preserve behavior, types, and existing style.

6. Keep the change minimal and rule-compliant:
   - no `any`
   - no non-null assertion operator (`!`)
   - no unnecessary comments or abstractions

7. Run the smallest relevant verification for the touched code (targeted test, typecheck, lint, or build check).

8. Report briefly:
   - git scope inspected (unstaged, staged, branch diff)
   - functions removed
   - files changed
   - verification run + result

If no safe single-use function exists, report that and make no edits.
