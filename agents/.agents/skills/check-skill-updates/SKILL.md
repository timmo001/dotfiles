---
name: check-skill-updates
description: Check imported skills for upstream changes and apply updates. Use when reviewing whether externally imported skills have new upstream content, or when `dot skill-updates` reports available changes.
---

# Check Skill Updates

Review and apply upstream changes to imported OpenCode skills that have `# origin:` tracking in their frontmatter.

## When to Use

- After an automated skill update reports changes and you want to review what changed
- When manually checking for upstream skill updates
- When `dot skill-updates` output needs agent-assisted review or selective application

## Workflow

1. Run `dot skill-updates --json` to check all imported skills against their upstream origins and get structured results.
2. Review the output: each skill reports up-to-date, changed, or failed.
3. For skills with upstream changes:
   - Review the normalised diff (local frontmatter adjustments are excluded).
   - Decide per skill: apply the update, skip, or investigate further.
4. When applying selectively, use `dot skill-updates --update --skill <name> --no-commit`.
5. If `--update` fails or selective application is needed, fall back to manually fetching and writing files using the `import-external-skill` skill workflow.
6. After applying updates, run `dot stow` to relink and `opencode debug skill` to verify skills load.

## Agent Usage

When running from an agent, use `--json` for reports and `--update --skill <name> --no-commit` for an approved clean update. Do not run bare `dot skill-updates`: interactive mode launches review prompts and can hang without a terminal.

## Upstream SHA Tracking

Each skill's SKILL.md frontmatter stores a `# upstream-sha:` comment with the latest upstream commit SHA that was checked. On subsequent runs, if the upstream SHA hasn't changed, the skill is reported as "up to date (cached)" and the full fetch-and-diff is skipped.

The SHA is written to frontmatter when:

- A full comparison confirms no diff (skill is genuinely up to date).
- An update is successfully applied (clean import).

The SHA is **not** written when:

- Running in `--check` mode (report-only; stays idempotent, does not modify files).
- The user skips a clean update in interactive mode (show it again next time).

Since the SHA lives in the committed frontmatter, it persists across machines and fresh clones. Commit the skill files after running `--update` or interactive mode to share the reviewed state.

## Modes

### Check only

Run `dot skill-updates --check`. Reports diffs without prompting or applying. Exits 1 if any updates are available, 0 if all skills are up to date. Use this to verify status without side effects.

Run `dot skill-updates --json` for the workflow-safe report. It returns a versioned document with each skill's state, origin, stored and upstream SHAs, changed file statuses, local-edit notes, and any error reason. It does not apply updates or change exit status when updates are available.

### Interactive (standalone)

Run `dot skill-updates` with no flags. Shows diffs and prompts `[y/N]` per skill.

### Auto-apply

`dot skill-updates --update` applies every clean update and commits the changed skill directories. Add `--skill <name>` to select one import and `--no-commit` when another process owns the commit, such as a pull request workflow.

## What Gets Compared

- All files in the skill directory are checked (SKILL.md and reference files).
- Normalisation strips known local changes before diffing:
  - Local side: `# origin:` and `# local-edits:` block removed.
  - Upstream side: `metadata`, `category`, `tags` fields removed.
- New upstream files are detected and added.
- Files removed upstream are removed from clean imported skills during apply.
- Only skills with `# origin:` in their YAML frontmatter are checked.
- Malformed tracked origins are reported instead of silently skipped.

## Local Edits

Skills that were adapted during import (body content changed, not just frontmatter) document their changes with a `# local-edits:` block in the frontmatter:

```yaml
# local-edits:
#   - description rewritten for local context
#   - section X condensed for brevity
```

### Behaviour

- `dot skill-updates --update` and `dot skill-updates --check` both **skip auto-apply** for skills with `# local-edits:`. Auto-applying would overwrite intentional local adaptations.
- The checker still reports the diffs and displays the local-edits notes so the reviewer can see whether upstream also changed beyond the known local edits.
- Interactive mode generates a paste-ready agent report for these skills at the end of the run.

### Updating skills with local edits

When upstream changes need merging into a locally adapted skill:

1. Fetch the upstream SKILL.md and reference files from the origin URL.
2. Compare upstream changes against the local version.
3. Present what changed upstream alongside the documented local edits.
4. Wait for the user to decide which upstream changes to merge.
5. Apply the agreed changes, preserving the local adaptations.
6. Update the `# local-edits:` block if the set of local changes changed.

This follows the `import-external-skill` skill (Path 2: Adaptation).

## Safety

- Updates only touch skills that have `# origin:` tracking; locally authored skills are never modified.
- Clean imports mirror the complete upstream directory. Declare intentional local-only files through `# local-edits:` so automation will not remove them.
- Local `description` is preserved across updates (not overwritten by upstream description).
- Edit stow source paths, not live paths.
- Do not commit without explicit user request.
