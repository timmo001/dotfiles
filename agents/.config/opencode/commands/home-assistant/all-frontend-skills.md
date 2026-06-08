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

Work only from files in the injected `<work-scope>`. Use `${ARGUMENTS}` only to narrow that current-work scope.

## References

Use the loaded skills' repository references and review rules before introducing new local patterns.

## Verification

- Run `yarn lint:types` when typing or context usage changes.
- Run targeted ESLint for touched files.
- Run targeted tests when behavior changes.
- Never run `yarn lint:types` with file arguments.

## Final Report

Report only the scope source used, skills applied, issues fixed, files changed, and verification result.
