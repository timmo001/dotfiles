---
allowed-tools: Read(*), Edit(*), Grep(*), Glob(*), Bash(yarn:*), Bash(git:*)
description: Migrate Home Assistant list components from MWC to new primitives in current git scope
---

# Migrate List Components

Load and apply the `home-assistant-frontend`, `home-assistant-list-components`, and `lit-rendering` skills before editing.

## Build Scope

Load the `branch-context-consumer` skill. Use work-scope mode.

1. Work only from files in that scope.
2. Optionally narrow scope by `${ARGUMENTS}` when provided.

## Inspect Before Editing

Use these repository references as the primary pattern sources:

```text
src/panels/config/components/ha-config-navigation-list.ts
src/panels/config/devices/ha-config-device-page.ts
gallery/src/pages/components/ha-list.markdown
```

## Migration Steps

For each file in scope containing `ha-list`, `ha-md-list`, `ha-list-item`, or `ha-md-list-item`:

1. Identify the interactivity of each list item (navigation, action, selection, display).
2. Replace the container with the appropriate new container (`ha-list-nav`, `ha-list-selectable`, or `ha-list-base`).
3. Replace each item with the correct new item variant.
4. Remap slots: `graphic` to `start`, `meta` to `end`, text to `headline`/`supporting-text`.
5. Remove MWC-only attributes (`twoline`, `hasMeta`, `hasGraphic`, `noninteractive`, `activated`).
6. Update event handlers (`@request-selected` to `ha-list-selected` or `@click`/`ha-list-activated`).
7. Update imports to the new component paths.

## Verification

- Run `yarn lint:types` when typing or component usage changes.
- Run targeted ESLint for touched files.
- Never run `yarn lint:types` with file arguments.

## Final Report

Report only:

- Scope source used (`BranchContextPlugin` context)
- Components migrated (old to new)
- Files changed
- Verification run and result
