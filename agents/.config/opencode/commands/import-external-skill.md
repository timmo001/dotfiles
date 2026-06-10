---
description: Import or review external skills for the local skill library
---

Load and follow the `import-external-skill` skill.

1. Use `${ARGUMENTS}` as the source. This is typically a URL to a skill file, skill directory, or skill repository.

2. If `${ARGUMENTS}` is empty, ask one concise question with the `question` tool to get the source URL or repo.

3. Determine the scope from the URL:
   - **Specific skill** (URL points to a SKILL.md or skill directory): follow Path 1 (Direct Import) or Path 2 (Adaptation) from the skill, depending on whether the skill overlaps with an existing local skill.
   - **Repository root or skills directory**: follow the Review Mode from the skill to survey available skills, present recommendations, and wait for the user to choose.

4. For direct imports:
   - Fetch raw files from the source.
    - Copy verbatim into `agents/.agents/skills/<skill-name>/`.
   - Adjust frontmatter: keep `name` and `description`, add `# origin:` comment, drop `metadata`/`category`/`tags`.
   - Diff each file against the upstream original to verify only frontmatter changed.
   - Run `dot stow` to link into place.
   - Run `dot opencode-debug` to confirm the skill loads.

5. For adaptations:
   - Fetch the external skill and compare against the existing local skill.
   - Present the comparison with gaps, overlaps, and conflicts.
   - Wait for user decisions before editing.

6. Do not commit unless the user explicitly asks.
