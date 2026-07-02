---
name: git-commit
description: Commit workflow using the dot git-commit gateway in the maintainer's concise one-line style. Use only after the user explicitly requests a commit or push, including /commit or /commit-push. Never infer repeat authorisation from an earlier commit or push; never run raw git commit.
---

# Git Commit

Create commits through the `dot git-commit` gateway, never raw `git commit`. The
gateway enforces the maintainer's style guards; this skill covers scope,
staging, and message authoring around it.

## 1. Authorisation and posture

- Only commit when the user asked for this specific commit (a `/commit` or
  `/commit-push` invocation, or an explicit "commit this" instruction).
  Drafting a message is not permission.
- A prior commit or push request authorises only that one action. Never treat a
  second change, a later clean working tree, or an earlier successful push as
  permission to commit or push again. Ask or stop unless the user explicitly
  requests another commit or push.
- Run in a build agent. Raw `git commit` is denied in the OpenCode permission
  config; `dot git-commit` is the allowed path. If `dot git-commit` is denied,
  stop and report that this needs a build agent, do not fall back to `git commit`.
- Never amend, rebase, or rewrite existing commits here. Never disturb a set the
  user staged without asking.

## 2. Read the working tree

- Use `dot git-status` for the state: branch, staged, unstaged, untracked.
- Use `dot git-status --diff` when you need the content to write an accurate
  subject. Do not reconstruct this with raw `git status`/`git diff`.

## 3. Decide the scope (confirm before staging)

- Prefer several small, coherent commits over one large one. Commit per change,
  step, or phase so each commit is concise and self-contained; do not lump an
  entire task into a single commit. This trades some rebase friction for a
  cleaner, non-conflicting history, which is the preferred tradeoff.
- If the user already staged files, commit that set. If you also made unrelated
  edits this session, ask before adding them rather than bundling silently.
- If nothing is staged, show the changed files and confirm which to include
  before staging. Only stage files you changed this session; never sweep
  pre-existing or unrelated changes. Never use `git add -A`.
- Include untracked files you created for this work; ask before adding anything
  unexpected.
- Keep formatter-only churn (files reformatted but not part of the change) out
  of the main commit. Offer a separate follow-up commit for it unless the user
  says otherwise.
- Prefer `--path <file>` (repeatable) to scope the commit to exact files; it
  commits only those and leaves any other staged files untouched. This is also
  how you make several scoped commits from one working tree.

## 4. Write the subject

- Author in the maintainer's voice per the `writing-style` skill: imperative,
  verb-first, sentence case, no trailing full stop, no Conventional Commit
  prefix, single line. Mirror recent `dot git-status` / `git log` subjects.
- The gateway enforces: single line, no em/en-dash (use a hyphen), no trailing
  full stop, no tabs/control characters. It warns over 60 characters and rejects
  over 120. Aim for roughly 60 or fewer.

## 5. Commit

```bash
dot git-commit -m "<subject>"                 # commit the staged set
dot git-commit -m "<subject>" --path src/x.ts # commit only these files
dot git-commit -m "<subject>" --dry-run       # preview, change nothing
```

- Use `--dry-run` first when unsure what is staged.
- If the gateway rejects the subject, fix it and rerun; do not work around it.
- The gateway refuses to commit to the base branch of a repo you do not own
  (owners in `git config dot.owner`), so you do not commit to, say, `dev` on
  `home-assistant/frontend`. This also applies to a fork kept for upstream PRs
  (foreign `upstream` remote): work on a feature branch, not the fork's base
  branch. A takeover fork with no foreign remote, and every non-base branch, are
  fine. The base branch is resolved from `origin/HEAD`, not assumed. Move to a
  feature branch and open a PR; do not try to work around the guard.

## 6. Push (only when asked)

```bash
dot git-commit -m "<subject>" --push
```

- `--push` pulls with `--rebase` (autostashing local edits) before pushing so a
  moved-ahead remote fast-forwards, sets the upstream when missing, and never
  force-pushes. On a rebase conflict it aborts and keeps your commit for manual
  integration. Only push when the user asked for this specific push (a
  `/commit-push` invocation or explicit "push").

## 7. Report

- Report the commit subject, the files committed, any separate formatting
  commit, and the push result.
