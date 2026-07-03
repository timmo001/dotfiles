---
name: remove-single-use-functions
description: Safe inlining and removal of single-use functions during code review and refactoring. Use when a local, non-exported helper has exactly one real call site and inlining preserves behaviour and readability.
---

# Remove Single-Use Functions

Use this skill when reviewing or editing cleanup/refactor changes that inline and remove functions used exactly once:

- The function must be local and non-exported.
- The function must have exactly one real call site after the current change set is applied.
- Preserve runtime behavior, types, and existing style.
- Skip public APIs, framework hooks, callbacks, overloaded or generic utilities, and test helpers kept for readability.
- Safe cleanup means inlining the function at its sole call site and then removing the original function definition.
- Do not introduce `any`.
- Do not use the non-null assertion operator (`!`).
- Do not add unnecessary comments or abstractions.
