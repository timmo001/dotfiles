---
allowed-tools: Read(*), Edit(*), Grep(*), Glob(*), Bash(yarn:*), Bash(git:*)
description: Review and fix Home Assistant Lit rendering and picker callback-shape patterns in current git scope
---

# Review Lit Rendering Patterns

Load and apply the `home-assistant-frontend`, `lit-rendering`, and `home-assistant-lit-rendering` skills before editing.

## Build Scope

Load the `branch-context-consumer` skill. Use work-scope mode.

Work only from files in the injected `<work-scope>`. Use `${ARGUMENTS}` only to narrow that current-work scope.

## Inspect Before Editing

Use the skills' repository reference guidance as the primary pattern source.

When context/lazy-context usage is part of the same change, also apply `home-assistant/lazy-context`.

## Verification

- Run `yarn lint:types` when typing or property usage changes.
- Run targeted ESLint for touched files.
- Run targeted tests when behavior changes.
- Never run `yarn lint:types` with file arguments.

## Final Report

Report only the scope source used, Lit rendering or callback-shape issues fixed, files changed, and verification result.
