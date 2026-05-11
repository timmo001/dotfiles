---
name: skill-notes
description: Standing preferences and constraints for evaluating, importing, or recommending skills. Use alongside import-external-skill and write-a-skill when assessing external skill sets or proposing new skills.
---

# Skill Notes

Consult these notes when evaluating external skills for import, recommending skills, or proposing new ones.

## Testing

- Do not use TDD, red-green-refactor, or test-first workflows.
- Tests are verification tools, not design drivers.
- Skip or flag any skill whose core workflow is TDD or test-first.
- If an otherwise useful skill includes TDD content, note the conflict and offer to adapt with the TDD parts removed.

## Issues and Planning

- The user writes their own issues, especially in shared repos.
- Skip skills that automate issue creation, breakdown-to-issues, or PRD-to-tickets workflows.
