---
allowed-tools: Read(*), Edit(*), Grep(*), Glob(*), Bash(yarn:*), Bash(git:*)
description: Apply all Home Assistant frontend skills in current git scope
---

# Apply Home Assistant Frontend Skills

Load and apply all Home Assistant frontend skills before editing.

Apply skill groups by pattern so new skills are picked up automatically:

- Apply `home-assistant-frontend` as the base skill.
- Apply all `home-assistant-*` skills.
- Apply all `lit-*` skills.
- Apply all `*-ts` skills.
- Apply cleanup skills for unnecessary variables and single-use helpers.

Current baseline examples:

- `home-assistant-frontend`
- `home-assistant-lazy-context`
- `home-assistant-list-components`
- `lit-rendering`
- `home-assistant-lit-rendering`
- `types-enforce-ts`
- `cleanup-unnecessary-variables`
- `remove-single-use-functions`

## Build Scope

Load the `branch-context-consumer` skill. Use work-scope mode.

1. Work only from files in that scope.
2. Optionally narrow scope by `${ARGUMENTS}` when provided.
3. Before final verification, re-scan touched files for avoidable aliases, one-shot object variables, inferred `: void` annotations, unused helper wrappers, and mode/capability gates that do not match existing behavior.

## References

Use these Home Assistant references first when relevant:

```text
src/data/context/index.ts
src/state/context-mixin.ts
src/state/lazy-context-provider.ts
src/components/ha-selector/ha-selector-select.ts
src/components/ha-target-picker.ts
src/components/ha-navigation-picker.ts
src/components/ha-label-picker.ts
src/panels/lovelace/cards/hui-button-card.ts
```

## Verification

- Run `yarn lint:types` when typing or context usage changes.
- Run targeted ESLint for touched files.
- Run targeted tests when behavior changes.
- Never run `yarn lint:types` with file arguments.

## Final Report

Report only:

- Scope source used (`BranchContextPlugin` context)
- Skills applied
- Issues fixed
- Files changed
- Verification run and result
