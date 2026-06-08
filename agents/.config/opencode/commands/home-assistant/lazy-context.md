---
allowed-tools: Read(*), Edit(*), Grep(*), Glob(*), Bash(yarn:*), Bash(git:*)
description: Review and fix Home Assistant frontend lazy-context and memoization usage in current git scope
---

# Review Lazy Context Usage

Load and apply the `home-assistant-frontend` and `home-assistant-lazy-context` skills before editing.

## Build Scope

Load the `branch-context-consumer` skill. Use work-scope mode.

Work only from files in the injected `<work-scope>`. Use `${ARGUMENTS}` only to narrow that current-work scope.

## Inspect Before Editing

Use the skill's provider, context, and repository reference guidance before changing context behavior.

If the scope is primarily Lit rendering and picker callback-shape changes, also apply `home-assistant/lit-rendering` (which applies both `lit-rendering` and `home-assistant-lit-rendering` skills).

## Verification

- Run `yarn lint:types` for context typing or memoization signature changes.
- Run targeted ESLint for touched files when imports/decorators/callback shapes change.
- Run targeted tests when behavior changes.
- Never run `yarn lint:types` with file arguments.

## Final Report

Report only the scope source used, context or memoization issues fixed, files changed, and verification result.
