---
name: git-commit
description: Commit workflow using the dot git-commit gateway in the maintainer's concise one-line style. Use when creating a git commit, running /commit or /commit-push, staging and committing current changes, or pushing a just-made commit. Never run raw git commit; route through dot git-commit.
---

# Git Commit

Create commits through the `dot git-commit` gateway, never raw `git commit`. The
gateway enforces the maintainer's style guards; this skill covers scope,
staging, and message authoring around it.

## 1. Authorisation and posture

- Only commit when the user asked (a `/commit` or `/commit-push` invocation, or
  an explicit "commit this" instruction). Drafting a message is not permission.
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
  commits only those and leaves any other staged files untouched.

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

## 6. Push (only when asked)

```bash
dot git-commit -m "<subject>" --push
```

- `--push` sets the upstream when missing and never force-pushes. Only push when
  the user asked (a `/commit-push` invocation or explicit "push").

## 7. Report

- Report the commit subject, the files committed, any separate formatting
  commit, and the push result.
