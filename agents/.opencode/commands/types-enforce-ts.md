---
description: Enforce TypeScript type safety in current git scope
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

3. Before editing, search local project guidance and reusable type sources:
   - local rules/docs (for example `AGENTS.md`, project style guides, lint/type config)
   - helper/data/type files that may already define reusable interfaces, unions, enums, and utility types
   - prefer reusing or extending existing local types instead of creating duplicate one-off types

4. From files in scope (optionally narrowed by `${ARGUMENTS}`), find TypeScript edits that weaken types or bypass type safety.

5. For each candidate, run this pre-check list before editing:
   - Preserve runtime behavior and public API shape unless user asked otherwise.
   - Prefer stricter and more precise types over broader types.
   - Avoid introducing `any`, unsafe double assertions, or blanket suppressions.
   - Prefer narrowing and type guards over non-null assertions and forced casts.
   - Keep inferred types when they are already clear and stable.

6. Apply the smallest safe type fixes for each passing candidate:
   - replace `any` with concrete types or `unknown` plus narrowing
   - remove unnecessary casts and non-null assertions (`!`) where safe
   - add minimal annotations for function params/returns when clarity or safety improves
   - align generics, unions, and nullability with real data flow

7. Apply TypeScript style rules when relevant:
   - prefer explicit, narrow types
   - remove unnecessary intermediate variables and one-off aliases
   - inline one-time-use values when clarity is maintained
   - prefer typing parameters at the signature level when it improves safety or clarity (for example `function onChange(e: XEvent<number>)`, `function onKeyDown(e: KeyboardEvent)`), and rely on inference when types are already clear; avoid casting later at value access points (for example `e.detail.value as number`, `(e as KeyboardEvent).key`)
   - if project generic helpers exist, prefer concrete generic types (for example `XEvent<number>`, `ApiResult<User>`, `EntityMap<Item>`) over ad-hoc casts and loosely typed objects
   - prefer top-level annotations and `satisfies` over type assertions when possible
   - keep control flow simple (early return/break) without changing established logic unless explicitly requested

8. Keep the change minimal and rule-compliant:
   - no `any`
   - no non-null assertion operator (`!`) unless strictly required and justified by existing project rules
   - no unnecessary comments or abstractions

9. Run the smallest relevant verification for the touched code (targeted typecheck, test, lint, or build check).

10. Report briefly:
   - git scope inspected (unstaged, staged, branch diff)
   - type issues fixed
   - files changed
   - verification run + result

If no safe TypeScript type-safety improvement exists, report that and make no edits.
