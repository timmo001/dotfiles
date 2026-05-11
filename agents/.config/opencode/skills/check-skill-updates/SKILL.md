---
name: check-skill-updates
description: Check imported skills for upstream changes and apply updates. Use when reviewing whether externally imported skills have new upstream content, or when `dot skill-updates` reports available changes.
---

# Check Skill Updates

Review and apply upstream changes to imported OpenCode skills that have `# origin:` tracking in their frontmatter.

## When to Use

- After `dot update` reports skill changes were auto-applied and you want to review what changed
- When manually checking for upstream skill updates
- When `dot skill-updates` output needs agent-assisted review or selective application

## Workflow

1. Run `dot skill-updates --check` to check all imported skills against their upstream origins.
2. Review the output: each skill reports up-to-date, changed, or failed.
3. For skills with upstream changes:
   - Review the normalised diff (local frontmatter adjustments are excluded).
   - Decide per skill: apply the update, skip, or investigate further.
4. When applying, use `dot skill-updates --update` to apply all changes at once.
5. If `--update` fails or selective application is needed, fall back to manually fetching and writing files using the `import-external-skill` skill workflow.
6. After applying updates, run `dot stow` to relink and `dot opencode-debug` to verify skills load.

## Agent Usage

When running from an agent, only use `--check` (report) and `--update` (apply all). Do not run bare `dot skill-updates` — interactive mode prompts `[y/N]` per skill and will hang without a terminal.

## Modes

### Check only

Run `dot skill-updates --check`. Reports diffs without prompting or applying. Exits 1 if any updates are available, 0 if all skills are up to date. Use this to verify status without side effects.

### Interactive (standalone)

Run `dot skill-updates` with no flags. Shows diffs and prompts `[y/N]` per skill.

### Auto-apply (during dot update)

`dot update` calls `dot skill-updates --update` automatically after stow. Changes are applied without prompting.

## What Gets Compared

- All files in the skill directory are checked (SKILL.md and reference files).
- Normalisation strips known local changes before diffing:
  - Local side: `# origin:` line removed.
  - Upstream side: `metadata`, `category`, `tags` fields removed.
- New upstream files are detected and added.
- Only skills with `# origin:` in their YAML frontmatter are checked.

## Safety

- Updates only touch skills that have `# origin:` tracking; locally authored skills are never modified.
- Local `description` is preserved across updates (not overwritten by upstream description).
- Edit stow source paths, not live paths.
- Do not commit without explicit user request.
