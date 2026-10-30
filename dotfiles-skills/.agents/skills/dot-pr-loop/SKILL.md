---
name: dot-pr-loop
description: >
  Run the watch, triage, fix and push loop on the session's pull requests
  until CI passes and every review finding is fixed or has a drafted reply,
  using dot-pr-watch for each round. Use as an OpenCode `/goal` objective
  (`/goal @dot-pr-loop`) or when asked to keep fixing a pull request until it
  is green and review-clean.
license: Apache-2.0
compatibility: Designed for OpenCode 2 `/goal` with background shells. Requires the dot-pr-watch and dot-git-commit skills, the dot CLI from timmo001/dotfiles and an authenticated GitHub CLI.
metadata:
  author: timmo001
---

# PR Loop

Keeps the session's pull requests moving until they settle, one round per turn. `dot-pr-watch` owns watching, reading the report, triage and drafting replies; load it and follow it for each of those steps. For the default branch with no pull request, use `ci-loop` instead.

Usually started with no pull request named:

```text
/goal @dot-pr-loop
```

## Scope and authorisation

Work out which pull requests the loop covers from the session: the ones it opened, pushed to or was asked about, which may be several. If that's unclear, ask rather than guess.

Starting this loop is the user's explicit request to fix, commit and push for those pull requests for as long as it runs. It covers nothing outside their changesets, and it doesn't lift `dot-pr-watch`'s posting rule: replies, comments, resolving threads and re-requesting reviews still need the user's yes.

## Each round

1. Make sure each unsettled pull request has a `dot pr watch` running in a background shell, grouped as `dot-pr-watch` describes (one per independent pull request, one for a stack). Never use a blocking Code Mode call, or a job without its `follow` shell: `/goal` only waits on the session's own running shells, and a watch's end wakes the session. Use `--stop-on review` while review feedback may still arrive, otherwise `--stop-on failure`. Keep a watch that is still running after a push rather than starting another.
2. Read each finished report and triage it under `dot-pr-watch`.
3. Fix every quick failure and valid finding in that pull request's changed code, run the checks the fix needs, then commit and push through `dot-git-commit` from that pull request's checkout. Diagnose rather than guess at a failure that isn't a quick fix.
4. End the turn so the watches run on the new heads.

## Done or stopped

Done when, for every one of those pull requests, the latest head's CI has passed, requested reviews have posted, and every open thread and review body finding is fixed or listed with a drafted reply.

Stop and report back as `dot-pr-watch` describes, with the drafts, instead of continuing when what's left is only replies or resolutions for the user, a failure looks flaky or infrastructure, a finding is invalid or needs a design decision, or the same failure survives two fixes.
