---
title: Commit Gateway
description: Guarded commits through dot git-commit instead of raw git commit.
---

## `dot git-commit`

`dot git-commit` is the guarded commit path for agents and local workflow commands. It creates normal git commits, but wraps the dangerous parts so commits stay scoped, styled, and harder to run on the wrong branch.

```bash
dot git-commit -m "Add commit gateway"                         # commit the staged set
dot git-commit -m "Scope to one file" --path src/git/Status.ts # commit only named files
dot git-commit -m "Commit and push" --push                     # commit, rebase-pull, then push
dot git-commit -m "Preview only" --dry-run                     # show the plan, change nothing
```

Agents use this command through the `git-commit` skill. Raw `git commit` is blocked in the OpenCode permission config, so `/commit` and `/commit-push` both route through the gateway. A commit or push request authorises only that specific action; a later change still needs a fresh explicit request.

## Scope

Without `--path`, the command commits the current staged set. It never runs `git add -A`.

Use repeated `--path <file>` flags when one working tree contains several unrelated changes. That commits only those files and leaves other staged or unstaged files alone.

`--dry-run` validates the message, resolves the target branch, prints the commit or push plan, and exits before staging, committing, or pushing.

## Message Guards

The gateway validates the subject before committing:

| Guard | Behaviour |
| --- | --- |
| Single line | Rejects multi-line messages and bodies. |
| Non-empty | Rejects blank subjects after trimming. |
| No em/en-dash | Rejects typographic dash punctuation; use a hyphen. |
| No trailing full stop | Rejects subjects ending in `.`. |
| Length limits | Warns over 60 characters, rejects over 120. |
| Plain text | Rejects tabs and control characters; warns on curly quotes, non-breaking spaces, and double spaces. |

The preferred style is a concise, imperative, single-line subject, for example `Add git commit gateway`.

## Branch Guard

The command refuses commits to the base branch of a repository you do not own. Ownership is configured with one or more `git config dot.owner <owner>` values.

The guard catches both a direct clone of someone else's repository and a fork with a foreign `upstream` remote. It resolves the base branch from the repository's default branch metadata rather than assuming `main` or `master`.

Work on a feature branch for upstream PRs. Personal repos, takeover forks with no foreign remote, and non-base branches are allowed.

## Push Mode

`--push` commits first, then pulls with `--rebase` before pushing. It sets an upstream for the current branch when one is missing and never force-pushes. Agents must only use it for the specific commit/push request the user just made.

If the rebase conflicts, the command aborts the push path and leaves the commit in place for manual integration.
