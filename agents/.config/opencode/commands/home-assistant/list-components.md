---
allowed-tools: Read(*), Edit(*), Grep(*), Glob(*), Bash(yarn:*), Bash(git:*)
description: Migrate Home Assistant list components from MWC to new primitives in current git scope
---

# Migrate List Components

Load and apply the `home-assistant-frontend`, `home-assistant-list-components`, and `lit-rendering` skills before editing.

## Build Scope

Load the `branch-context-consumer` skill. Use work-scope mode.

Work only from files in the injected `<work-scope>`. Use `${ARGUMENTS}` only to narrow that current-work scope.

## Inspect Before Editing

Use the `home-assistant-list-components` skill's migration rules and repository references as the primary pattern source.

## Migration Steps

Migrate only list containers or items in scope that the skill identifies as safe to update.

## Verification

- Run `yarn lint:types` when typing or component usage changes.
- Run targeted ESLint for touched files.
- Never run `yarn lint:types` with file arguments.

## Final Report

Report only the scope source used, components migrated, files changed, and verification result.
