---
name: skill-consumers
description: >
  Share skills from timmo001/skills with a repository through the skill
  consumers sync on these devices, with `dot skills consumers add`. Use
  when asked to share, add or remove shared skills in a repository, add or
  drop a repository in the skills sync, or check why the sync has not reached one.
license: Apache-2.0
compatibility: Requires the dot CLI with skill-maintenance and the dot-managed skills checkout installed by dot update, the private skill-consumers timer, a writable ~/repos/skills checkout, authenticated GitHub CLI and dot git-commit.
metadata:
  author: timmo001
---

# Skill consumers

`consumers.yml` in `~/repos/skills` lists the repositories that keep project copies of shared skills, and which skills each gets. The `skill-consumers` timer syncs that list hourly from the dot-managed checkout. It adds, updates and removes those copies and pushes them to each repository's default branch.

## Share skills

```bash
dot skills consumers add [--repo <owner/repo>] <skill>...
```

Without `--repo`, it uses the GitHub repository of the current directory. It adds the skills to that repository's entry, creating the entry if needed, and commits `consumers.yml` in `~/repos/skills` through `dot git-commit`. New repositories must be public, owned by the skills repository's owner, and not archived. Only skills that work outside these devices suit consumers: those in the Portable section of `~/repos/skills/SKILLS.md`, and external imports (`"distribution": "external"` in `~/repos/skills/imports.json`) whose origin skill is general guidance, such as a library's skill for a repository that uses it. Unlicensed imports are refused. If the user did not name skills, read both and suggest the ones whose descriptions fit the repository's stack and work.

## Remove skills

```bash
dot skills consumers remove [--repo <owner/repo>] <skill>...
dot skills consumers remove [--repo <owner/repo>] --all
```

Removing some skills commits the shorter list, and the next sync deletes those copies. Removing the last skill, or `--all`, drops the repository's entry. The sync stops visiting a dropped repository, so the command deletes its copies and pushes that to the repository's default branch straight away, then commits the entry removal. Until that commit reaches skills `main` and `dot update` runs, the timer can add the copies back. Either way, copies edited in the repository are left alone and reported.

## Reaching the repository

The commands do not push to skills `main`. The timer reads the dot-managed checkout, so a change syncs only after it is pushed to skills `main` and `dot update` has run. Push only when asked. To sync straight away after that, run `dot services start skill-consumers.timer`, which pushes to every listed repository that needs it, so only do so when the user asked for the push.

Check recent runs with `dot services run-logs skill-consumers.timer`.
