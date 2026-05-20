---
allowed-tools: Read(*), Edit(*), Grep(*), Glob(*), Bash(yarn:*), Bash(git:*)
description: Review and fix Home Assistant frontend lazy-context and memoization usage in current git scope
---

# Review Lazy Context Usage

Load and apply the `home-assistant-frontend` and `home-assistant-lazy-context` skills before editing.

## Build Scope

Load the `branch-context-consumer` skill. Use work-scope mode.

1. Work only from files in that scope.

## Inspect Before Editing

Read these files when provider/context behavior is relevant:

```text
src/data/context/index.ts
src/state/context-mixin.ts
src/state/lazy-context-provider.ts
```

Use these repository references to match local patterns:

```text
src/components/ha-label-picker.ts
src/components/ha-selector/ha-selector-select.ts
src/components/ha-target-picker.ts
src/components/ha-navigation-picker.ts
src/panels/config/integrations/integration-panels/zwave_js/dialog-zwave_js-rebuild-network-routes/dialog-zwave_js-rebuild-network-routes-detail.ts
src/panels/lovelace/cards/hui-button-card.ts
```

If the scope is primarily Lit rendering and picker callback-shape changes, also apply `home-assistant/lit-rendering` (which applies both `lit-rendering` and `home-assistant-lit-rendering` skills).

## Verification

- Run `yarn lint:types` for context typing or memoization signature changes.
- Run targeted ESLint for touched files when imports/decorators/callback shapes change.
- Run targeted tests when behavior changes.
- Never run `yarn lint:types` with file arguments.

## Final Report

Report only:

- Scope source used (`BranchContextPlugin` context)
- Context/memoization issues fixed
- Files changed
- Verification run and result
