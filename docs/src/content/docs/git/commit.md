---
title: Commit Gateway
description: Guarded commits through dot git-commit instead of raw git commit.
sidebar:
  order: 4
---

## `dot git-commit`

`dot git-commit` is the guarded commit path for agents and local workflow commands. It creates normal git commits, but wraps the dangerous parts so commits stay scoped, styled, and harder to run on the wrong branch.

```bash
dot git-commit -m "Add commit gateway"                         # commit the staged set
dot git-commit -m "Scope to one file" --path src/git/Status.ts # commit only named files
dot git-commit -m "Commit and push" --push                     # commit, rebase-pull, then push
dot git-commit --amend                                         # fold staged changes into HEAD, keep its message
dot git-commit --amend -m "Reword last commit"                 # rewrite HEAD's subject
dot git-commit -m "Preview only" --dry-run                     # show the plan, change nothing
```

Agents use this command through the `git-commit` skill. Raw `git commit` is blocked in the OpenCode permission config, so `/commit`, `/commit-push`, and `/commit-push-watch` all route through the gateway. A commit or push request authorises only that specific action; a later change still needs a fresh explicit request. `/commit-push` omits post-push background workflow watchers, while `/commit-push-watch` opts into them. Direct use of the skill continues to watch after a successful push by default.

## Agent workflow

The `commit-context` plugin injects a `<commit-context>` block before `/commit`, `/commit-push`, and `/commit-push-watch` run. The commands stay in the parent session, so they retain the reviewed conversation without injecting full patches.

When files are already staged, that staged set supplies the attribution candidates. Otherwise, candidates are current dirty paths that OpenCode recorded as touched by the session tree. Candidate paths are a discovery superset, not authorisation to commit them all. The agent filters every path against the active user request and excludes or clarifies unrelated work, even when it is staged or belongs to a separate coherent change. Session attribution is path-level, not hunk-level: a file can still contain pre-existing or concurrent edits that require a question.

The agent refreshes through the Context MCP server's `git_context` tool or stops when attribution is incomplete. It never broadens the scope to every dirty file. See [Context Integration](/git/context/#commit-context-commit-context) for the evidence sources, multi-repository scopes, and fallback rules.

Staging and commit still go through `dot git-commit` only after the user explicitly requests a commit or push.

## Scope

Without `--path`, the command commits the current staged set. It never runs `git add -A`.

Use repeated `--path <file>` flags when one working tree contains several unrelated changes. That commits only those files and leaves other staged or unstaged files alone.

`--dry-run` validates the message, resolves the target branch, prints the commit or push plan, and exits before staging, committing, or pushing.

## Amend Mode

`--amend` rewrites the previous commit instead of creating a new one. It folds the staged set (or a `--path` scope) into HEAD and, without `--message`, keeps HEAD's existing message. Pass `--message` to reword the subject; it runs through the same message guards. An amend with nothing staged is allowed, so `--amend -m "..."` is the way to reword the last commit.

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

`--push` commits first, then pulls with `--rebase` before pushing. It sets an upstream for the current branch when one is missing and never runs a plain force-push. Agents must only use it for the specific commit/push request the user just made.

When combined with `--amend`, the push instead uses `--force-with-lease`: the rewritten commit only overwrites the remote branch when it still matches the ref we last saw, so a teammate's or bot's newer commit blocks the push rather than being clobbered. The pull-rebase step is skipped in this case.

If the rebase conflicts, the command aborts the push path and leaves the commit in place for manual integration.
