---
description: Check imported skills for upstream updates
---

Load and follow the `check-skill-updates` skill.

1. Run `dot skill-updates --check` to see which imported skills have upstream changes.

2. If all skills are up to date, report that and stop.

3. If updates are available, present a summary of each skill with changes and what changed.

4. If `${ARGUMENTS}` contains a skill name, focus on that skill only.

5. Distinguish between two categories in the output:

   **Clean updates** (no `# local-edits:` in frontmatter):
   - Ask the user whether to apply (all, selected, or none).
   - For accepted updates, run `dot skill-updates --update` to apply.
   - If `--update` fails or the user wants selective application, fall back to manually
     fetching and writing files using the `import-external-skill` skill workflow.

   **Skills with local edits** (`# local-edits:` present in frontmatter):
   - These are skipped by `--update` automatically. Do not attempt to auto-apply.
   - Present the local-edits notes from the frontmatter alongside the diff.
   - If the user wants to merge upstream changes, fetch the upstream version manually,
     compare against local, and present what changed upstream so the user can decide
     what to selectively merge. Follow the `import-external-skill` skill (Path 2: Adaptation).

6. Do NOT use interactive mode (no flags) — the agent cannot respond to terminal prompts.

7. After applying any updates, run `dot stow` and `dot opencode-debug` to verify.

8. Do not commit unless the user explicitly asks.
