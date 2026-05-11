---
name: import-external-skill
description: Import skills from external repos into the local dotfiles skill library. Use when pulling in a skill from a public repo, reviewing an external skill set for useful additions, or adapting external skill content into existing local skills.
---

# Import External Skill

Import skills from external repositories into the local OpenCode skill library under `~/.config/dotfiles/agents/.config/opencode/skills/`.

## When to Use

- Pulling in a specific skill from a public repo URL
- Reviewing an external skill repository for useful additions
- Adapting external skill content to improve existing local skills

## Two Paths

### Path 1: Direct Import

Use when the external skill is useful as-is and does not overlap with an existing local skill.

1. Fetch the raw SKILL.md and any reference files from the source.
2. Copy them verbatim into a new skill directory under the local skills path.
3. Replace the frontmatter metadata block (if present) with the local format: keep only `name`, `description`, and add an `# origin:` comment with the source tree URL.
4. Diff each local file against the upstream original to verify the only changes are the frontmatter adjustment.
5. Run `dot stow` to link the new skill into place.
6. Run `dot opencode-debug` to confirm the skill appears in the resolved config.

### Path 2: Adaptation

Use when the external skill overlaps with or extends an existing local skill.

1. Fetch the external SKILL.md.
2. Compare it against the existing local skill, identifying gaps and conflicts.
3. Present the comparison: what the external skill adds, what overlaps, and what conflicts with existing rules.
4. Wait for the user to decide which additions to make.
5. Apply the agreed changes to the existing local skill.

## Frontmatter Format

```yaml
---
name: skill-name
description: One or two sentences. First sentence says what. Second says when to use.
# origin: https://github.com/org/repo/tree/main/skills/skill-name
---
```

Drop upstream-only fields (`metadata`, `category`, `tags`) that the local skill loader does not use.

If the import adapts body content beyond the frontmatter (condensing sections, reformatting, etc.), add a `# local-edits:` block documenting what was changed and why. This tells `dot skill-updates` that the resulting diffs are intentional:

```yaml
# origin: https://github.com/org/repo/tree/main/skills/skill-name
# local-edits:
#   - description rewritten for local context
#   - section X condensed for brevity
```

## Commit Format

```
Skill title

Origin:
https://github.com/org/repo/tree/main/skills/skill-name
```

## Review Mode

When given a repo URL without a specific skill path, review the full skill set:

1. List all available skills in the repo.
2. Filter out domain-specific skills irrelevant to the local setup.
3. Compare remaining skills against the existing local skill library for overlaps.
4. Present a recommendation table: pull in, adapt into existing, or skip -- with reasoning.
5. Wait for the user to choose before importing or adapting anything.

## Safety

- Do not modify existing skills during a direct import.
- Do not import without diffing against the upstream original.
- Do not commit without explicit user request.
- Edit stow source paths, not live paths.
