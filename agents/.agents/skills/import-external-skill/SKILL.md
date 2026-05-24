---
name: import-external-skill
description: Import skills from external repos into the local dotfiles skill library. Use when pulling in a skill from a public repo, reviewing an external skill set for useful additions, or adapting external skill content into existing local skills.
---

# Import External Skill

Import skills from external repositories into the local OpenCode skill library under `~/.config/dotfiles/agents/.agents/skills/`.

## When to Use

- Pulling in a specific skill from a public repo URL
- Reviewing an external skill repository for useful additions
- Adapting external skill content to improve existing local skills

## Agent-Specific Repos

External skill repos are often written for a specific agent framework (e.g. Claude Code, Codex, Cursor). Skills from these repos may need adaptation even for a "direct import":

- Unknown frontmatter fields are silently ignored by OpenCode, so framework-specific fields like `allowed-tools`, `disable-model-invocation`, or `argument-hint` can stay.
- Replace framework-specific tool names, hook mechanisms, or sub-agent delegation patterns in the skill body with local equivalents.
- Remove references to framework-specific scaffolding, plugins, or conventions that do not exist locally.
- If the skill body is portable as-is, treat it as a direct import. If the body needs rewriting, treat it as an adaptation and document the changes in `# local-edits:`.

## Two Paths

### Path 1: Direct Import

Use when the external skill is useful as-is and does not overlap with an existing local skill.

1. Fetch the raw SKILL.md and any reference files from the source. Prefer `gh_grep` for fetching file content over `gh api` to reduce rate-limit pressure.
2. Write them verbatim into new files under the local skills path. Do not rewrite content by hand -- copy the upstream text exactly, then make targeted edits. This ensures diffs against upstream stay minimal and reviewable.
3. Add `# origin:` and `# upstream-sha:` comments to the frontmatter. The origin is the source tree URL; the SHA is the latest upstream commit that touched the skill. Keep all existing fields; unknown frontmatter is silently ignored.
4. Diff each local file against the upstream original to verify the only changes are the frontmatter adjustment and any framework-specific cleanup.
5. Run `dot stow` to link the new skill into place.
6. Run `dot opencode-debug` to confirm the skill appears in the resolved config.

### Path 2: Adaptation

Use when the external skill overlaps with or extends an existing local skill.

1. Fetch the external SKILL.md and any reference files. Prefer `gh_grep` over `gh api` for content fetches.
2. For new reference files being added to an existing skill, write the upstream content verbatim first, then make targeted edits. Do not rewrite files from scratch -- this guarantees diffs against upstream are minimal and reviewable.
3. Compare against the existing local skill, identifying gaps and conflicts.
4. Present the comparison: what the external skill adds, what overlaps, and what conflicts with existing rules.
5. Wait for the user to decide which additions to make.
6. Apply the agreed changes to the existing local skill.

## Frontmatter Format

```yaml
---
name: skill-name
description: One or two sentences. First sentence says what. Second says when to use.
# origin: https://github.com/org/repo/tree/main/skills/skill-name
# upstream-sha: abc123...
---
```

OpenCode ignores unknown frontmatter fields, so upstream-only fields (`metadata`, `category`, `tags`, `allowed-tools`, etc.) can stay.

The `# upstream-sha:` line stores the latest upstream commit SHA so unchanged origins can be skipped on subsequent `dot skill-updates` runs. Set it during import to the commit that last touched the skill. It is also updated automatically by `dot skill-updates`.

If the import adapts body content beyond the frontmatter (condensing sections, reformatting, etc.), add a `# local-edits:` block documenting the differences from upstream. This tells `dot skill-updates` that the diffs are intentional. List what differs, not a changelog of what was done:

```yaml
# origin: https://github.com/org/repo/tree/main/skills/skill-name
# upstream-sha: abc123...
# local-edits:
#   - SKILL.md: condensed body, rewritten description
#   - SOME-FILE.md: framework-specific pattern replaced with local equivalent
```

## Commit Format

```
Skill title

Origin:
https://github.com/org/repo/tree/main/skills/skill-name
```

## User Context

Before ranking external skills, understand what the user actually works on. Check their GitHub profile for recently pushed repos (`gh api users/{user}/repos --paginate --jq ...`) to build a picture of:

- **Languages and frameworks** used across active repos
- **Ownership roles** -- sole owner vs. contributor/maintainer on a shared project
- **Project types** -- libraries, applications, tooling, config repos

Skills that assume full control of a project's issue tracker, labelling, or team process are only relevant for repos where the user has full ownership, not for shared projects where they are one maintainer among many.

If recent activity does not clearly indicate the user's primary work, languages, or ownership roles, ask before ranking.

## Review Mode

When given a repo URL without a specific skill path, review the full skill set:

1. List all available skills in the repo.
2. Filter out domain-specific skills irrelevant to the user context above.
3. Compare remaining skills against the existing local skill library for overlaps.
4. Present a recommendation table: pull in, adapt into existing, or skip -- with reasoning.
5. Wait for the user to choose before importing or adapting anything.

## Safety

- Do not modify existing skills during a direct import.
- Do not import without diffing against the upstream original.
- Do not commit without explicit user request.
- Edit stow source paths, not live paths.
- Ensure imported scripts are executable (`chmod +x`) after writing them to disk.
