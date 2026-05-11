---
description: Check imported skills for upstream updates
---

Load and follow the `check-skill-updates` skill.

1. Run `dot skill-updates --check` to see which imported skills have upstream changes.

2. If all skills are up to date, report that and stop.

3. If updates are available, present a summary of each skill with changes and what changed.

4. If `${ARGUMENTS}` contains a skill name, focus on that skill only.

5. Ask the user whether to apply updates (all, selected, or none).

6. For accepted updates, run `dot skill-updates --update` to apply all changes.
   Do NOT use interactive mode (no flags) — the agent cannot respond to terminal prompts.
   If `--update` fails or the user wants selective application, fall back to manually fetching
   and writing files using the `import-external-skill` skill workflow.

7. After applying, run `dot stow` and `dot opencode-debug` to verify.

8. Do not commit unless the user explicitly asks.
