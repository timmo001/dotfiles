---
name: git-commit
description: Commit workflow using the dot git-commit gateway, splitting a reviewed changeset into coherent commits by default. Use only after the user explicitly requests a commit or push, including /commit or /commit-push. Never infer authorisation for later changes; never run raw git commit.
---

# Git Commit

Create commits through the `dot git-commit` gateway, never raw `git commit`. The
gateway enforces the maintainer's style guards; this skill covers scope,
staging, and message authoring around it.

## 1. Authorisation and posture

- Only commit when the user asked to commit the current reviewed changeset (a
  `/commit` or `/commit-push` invocation, or an explicit "commit this"
  instruction). Drafting a message is not permission.
- One request authorises the coherent commit series needed for that changeset.
  It does not authorise a later change, a second changeset, or another push.
  Ask or stop unless the user explicitly requests that follow-up work.
- Run in a build agent. Raw `git commit` is denied in the OpenCode permission
  config; `dot git-commit` is the allowed path. If `dot git-commit` is denied,
  stop and report that this needs a build agent, do not fall back to `git commit`.
- Amend only when the user explicitly requests it and follow the guarded amend
  flow below. Never rebase or otherwise rewrite existing commits here. Never
  disturb a set the user staged without asking.

## 2. Read the working tree

- For `/commit` and `/commit-push`, use the injected `<commit-context>` first.
  It combines branch metadata, candidate and excluded paths, a compact diff
  stat, and recent subject evidence with paths touched by the session tree.
- A complete, unambiguous block is sufficient. Do not repeat the context read
  or announce a staging plan before executing the scoped gateway commands.
- When the block contains several `<repository-scope>` sections, treat each as
  an independent changeset. Run its `dot git-commit` commands from the listed
  repository root, and push that repository only once on its final commit.
- Refresh with the Context MCP server's `git_context` tool when the block is
  absent, stale, partial, or does not cover an explicitly requested repository.
  In OpenCode this is exposed as `context_git_context`; set `diff: true` when
  subject selection needs content. Do not reconstruct this with raw `git
  status`/`git diff`.

## 3. Decide the scope (confirm before staging)

- Prefer several small, coherent commits over one large one. Commit per change,
  step, or phase so each commit is concise and self-contained; do not lump an
  entire task into a single commit. This trades some rebase friction for a
  cleaner, non-conflicting history, which is the preferred tradeoff.
- Make a single commit only when the user explicitly requests one or the
  reviewed changeset contains only one coherent change.
- If the user already staged files, commit that set. If you also made unrelated
  edits this session, ask before adding them rather than bundling silently.
- If nothing is staged, show the changed files and confirm which to include
  before staging unless a complete injected `<commit-context>` already supplies
  an unambiguous candidate scope. Only stage files attributed to this session;
  never sweep pre-existing, excluded, or unrelated changes. Never use `git add
  -A`.
- Session attribution is path-level, not hunk-level. If a candidate file may
  contain pre-existing or concurrent hunks, ask rather than treating the whole
  file as owned by this session.
- Include untracked files you created for this work; ask before adding anything
  unexpected.
- Keep formatter-only churn (files reformatted but not part of the change) out
  of the main commit. Offer a separate follow-up commit for it unless the user
  says otherwise.
- Prefer `--path <file>` (repeatable) to scope the commit to exact files; it
  commits only those and leaves any other staged files untouched. This is also
  how you make several scoped commits from one working tree.

## 4. Write the subject

- Author in the maintainer's voice: imperative, verb-first, sentence case, no
  trailing full stop, no Conventional Commit prefix, single line. Mirror recent
  subjects from the injected context, `git_context`, or `git log`.
- The gateway enforces: single line, no em/en-dash (use a hyphen), no trailing
  full stop, no tabs/control characters. It warns over 60 characters and rejects
  over 120. Aim for roughly 60 or fewer.

## 5. Commit

```bash
dot git-commit -m "<subject>"                 # commit the staged set
dot git-commit -m "<subject>" --path src/x.ts # commit only these files
dot git-commit --amend                        # fold staged changes into HEAD, keep its message
dot git-commit --amend -m "<subject>"         # rewrite HEAD's subject (reword)
dot git-commit -m "<subject>" --dry-run       # preview, change nothing
```

- Skip `--dry-run` when you already know what is staged and are safe to commit;
  `git_context` (step 2) is the check for that, and the preview adds little
  beyond it. Reserve `--dry-run` for when you are genuinely unsure what is staged.
- Use `--amend` only to fix up the previous commit the user just made, and only
  when they ask for an amend. Without `--message` it keeps HEAD's message; pass
  `--message` to reword. An amend with nothing staged is allowed, so
  `--amend -m "<subject>"` is how you reword the last commit. Do not amend a
  commit someone else may have based work on.
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
- For a split changeset, omit `--push` from every preceding commit and pass it
  only to the final commit so the complete series is pushed once.
- Combining `--amend --push` force-pushes with `--force-with-lease` (never a
  plain force): it overwrites the remote branch only when it still matches the
  ref last seen, so a teammate's or bot's newer commit blocks the push instead
  of being clobbered. Only do this on a branch that is safe to rewrite.

## 7. Report

- Report the commit subject, the files committed, any separate formatting
  commit, and the push result.
