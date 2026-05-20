---
allowed-tools: Read(*), Edit(*), Grep(*), Glob(*), Bash(yarn:*), Bash(git:*)
description: Review and fix Home Assistant Lit rendering and picker callback-shape patterns in current git scope
---

# Review Lit Rendering Patterns

Load and apply the `home-assistant-frontend`, `lit-rendering`, and `home-assistant-lit-rendering` skills before editing.

## Build Scope

Load the `branch-context-consumer` skill. Use work-scope mode.

1. Work only from files in that scope.

## Inspect Before Editing

Use these repository references as the primary pattern sources:

```text
src/components/ha-selector/ha-selector-select.ts
src/components/ha-target-picker.ts
src/components/ha-navigation-picker.ts
```

When context/lazy-context usage is part of the same change, also apply `home-assistant/lazy-context`.

## Verification

- Run `yarn lint:types` when typing or property usage changes.
- Run targeted ESLint for touched files.
- Run targeted tests when behavior changes.
- Never run `yarn lint:types` with file arguments.

## Final Report

Report only:

- Scope source used (`BranchContextPlugin` context)
- Lit rendering/callback-shape issues fixed
- Files changed
- Verification run and result
