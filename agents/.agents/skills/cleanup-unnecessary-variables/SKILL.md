---
name: cleanup-unnecessary-variables
description: Safe removal of unnecessary variables during code review and refactoring. Use when simplifying code, inlining temporary or single-use variables, or removing redundant aliases, while preserving runtime behaviour, evaluation order, and variables kept for readability or debugging.
---

# Cleanup Unnecessary Variables

Use this skill when reviewing or editing cleanup/refactor changes that remove or inline variables:

- The candidate must be local and non-exported.
- Preserve evaluation order and runtime behavior.
- Do not remove a value that is reused, mutated, or intentionally named for readability.
- Skip values with side-effectful initializers unless inlining keeps the same single execution.
- Skip public constants, config or env bindings, and values used as debug breakpoints or log anchors.
- Inline single-use temporary variables directly at the use site when safe.
- Remove no-op aliases such as `const x = y` when direct usage is clearer.
- Treat aliases of instance fields or parameters (`const params = this._params`, `const value = props.value`) as no-op aliases unless they preserve a required snapshot, narrowing across async boundaries, evaluation order, or readability for repeated complex access.
- Inline object literals that are constructed only to be passed immediately to one function or event payload, when doing so preserves clarity and behavior.
- Drop dead assignments and declarations that are never read.
- Flatten deep nesting via guard clauses and early returns when it reduces indentation without obscuring control flow.
- Do not introduce `any`.
- Do not use the non-null assertion operator (`!`).
- Do not add unnecessary comments or abstractions.
