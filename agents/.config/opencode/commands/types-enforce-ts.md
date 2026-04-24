---
description: Enforce TypeScript type safety in current git scope
---

Follow current rules before making changes.
Follow local project rules while editing.
Do not assume ambiguous intent is clear; when ambiguity would change edits, ask one targeted question before changing code.
When user feedback conflicts with your assumption, treat user feedback as authoritative.

Read and apply the `types-enforce-ts` rule before editing.

1. Build scope in this exact order:
   - unstaged changes (`git diff`)
   - staged changes (`git diff --cached`)
   - current branch diff from default branch (`git diff <default>...HEAD`) only when the current branch is not the default branch

2. Determine default branch from `origin/HEAD` when available; otherwise use the first existing fallback in: `dev`, `main`, `master`.

3. Before editing, search local project guidance and reusable type sources:
   - local rules/docs (for example `AGENTS.md`, project style guides, lint/type config)
   - helper/data/type files that may already define reusable interfaces, unions, enums, and utility types
   - prefer reusing or extending existing local types instead of creating duplicate one-off types

4. From files in scope (optionally narrowed by `${ARGUMENTS}`), find TypeScript edits that weaken types or bypass type safety.

5. Apply the smallest safe type fixes that satisfy the `types-enforce-ts` rule.

6. Run the smallest relevant verification for the touched code (targeted typecheck, test, lint, or build check).

7. Report briefly:
    - git scope inspected (unstaged, staged, branch diff)
    - type issues fixed
    - files changed
    - verification run + result

If no safe TypeScript type-safety improvement exists, report that and make no edits.
