---
name: dot-skill-consumers
description: >
  Share skills from timmo001/skills with a repository through the skill
  consumers sync on these devices, with `dot skills consumers add`. Use
  when asked to share, add or remove shared skills in a repository, add or
  drop a repository in the skills sync, or check why the sync has not reached one.
license: Apache-2.0
compatibility: Requires the dot CLI with skill-maintenance installed by dot update, the private skill-consumers timer, a writable ~/repos/skills checkout, authenticated GitHub CLI and dot git commit.
metadata:
  author: timmo001
---

# Skill consumers

`consumers.yml` in `~/repos/skills` lists the repositories that keep project copies of shared skills, and which skills each gets. The `skill-consumers` timer syncs that list hourly (except 01:00-07:00) from its own checkout of skills `main`, refreshed each run. It adds, updates and removes those copies and pushes them to each repository's default branch.

## Share skills

```bash
dot skills consumers add [--repo <owner/repo>] <skill>...
```

Without `--repo`, it uses the GitHub repository of the current directory. It adds the skills to that repository's entry, creating the entry if needed, commits and pushes `consumers.yml` in `~/repos/skills` through `dot git commit`, then installs the skills in that repository and pushes them to its default branch straight away. New repositories must be public, owned by the skills repository's owner, and not archived. Only skills that work outside these devices suit consumers: those in the Portable section of `~/repos/skills/SKILLS.md`, and external imports (`"distribution": "external"` in `~/repos/skills/imports.json`) whose origin skill is general guidance, such as a library's skill for a repository that uses it. Unlicensed imports are refused. If the user did not name skills, read both and suggest the ones whose descriptions fit the repository's stack and work.

## Remove skills

```bash
dot skills consumers remove [--repo <owner/repo>] <skill>...
dot skills consumers remove [--repo <owner/repo>] --all
```

Removing some skills commits and pushes the shorter list, then deletes those copies from the repository straight away. Removing the last skill, or `--all`, deletes the copies first, then drops the repository's entry. Either way, copies edited in the repository are left alone and reported.

## Reaching the repository

Both commands push to skills `main` and to the target repository, so run them only when the user asked to share or remove skills. They refuse while `~/repos/skills` has other unpushed commits or uncommitted changes to `consumers.yml`, imports or the shared skills. If the repository sync fails after the push, the timer retries it. To resync every listed repository, run `dot services start skill-consumers.timer`, which also pushes, so only do so when asked.

Check recent runs with `dot services run logs skill-consumers.timer`.
