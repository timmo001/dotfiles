---
allowed-tools: Read(*), Edit(*), Grep(*), Glob(*), Bash(yarn:*), Bash(git:*)
description: Apply all Home Assistant frontend skills in current git scope
---

# Apply Home Assistant Frontend Skills

Load and apply all Home Assistant frontend skills before editing. Repository-local skills own Home Assistant implementation conventions; global skills add cross-project engineering overlays.

Apply skill groups by pattern so new skills are picked up automatically:

- Apply `home-assistant-frontend` as the base skill.
- Apply all repo-local `ha-frontend-*` skills.
- Apply all `home-assistant-*` skills.
- Apply all `lit-*` skills.
- Apply all `*-ts` skills.
- Apply all `cleanup-*` and `remove-single-use-*` skills.

Treat the repo-local `ha-frontend-*` skills as authoritative when guidance overlaps. For rendering or picker work, apply both `lit-rendering` and `home-assistant-lit-rendering`.

## Build Scope

Load the `branch-context-consumer` skill. Use work-scope mode.

Work only from files in the injected `<work-scope>`. Use `${ARGUMENTS}` only to narrow that current-work scope.

## References

Use the repository-local skills' references and review rules before introducing new patterns. Use global companion skills only as overlays where they do not conflict.

## Verification

Use `ha-frontend-testing` to choose and run validation for the scoped changes.

## Final Report

Report only the scope source used, skills applied, issues fixed, files changed, and verification result.
