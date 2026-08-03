---
name: workflows-watch
description: Watch GitHub Actions workflows in an experimental background task and return the result. Use when asked to watch checks, wait for workflows, or follow workflow runs without blocking the main agent; diagnose and fix only when the caller explicitly requests fix mode.
---

# Workflows Watch

Delegate long-running GitHub Actions waits to one experimental background task
so the main agent does not block on a foreground `gh` watch.

## Modes

- **Watch mode is the default.** Wait for the workflow target, then return its
  terminal result and failed job details without editing files.
- **Fix mode is explicit.** Enter it only when the user or calling workflow
  clearly asks to diagnose and fix failures. `/fix-workflows` and the
  post-push `git-commit` cycle opt into this mode. Code review stays in watch
  mode unless the user separately asks for a fix.

## Workflow

1. Resolve the repository, branch, pull request, workflow run, and current
   working-tree scope before delegation. Record the exact pushed commit SHA so
   the task cannot attach to an older run. Use an explicit matching run ID when
   available; otherwise have the task discover or watch the pull request checks
   for that SHA.
2. Check live CLI help before selecting the watch command. Prefer:
   - `gh run watch <run-id> --compact --exit-status --interval 10`
   - `gh pr checks <pr> --watch`
3. Launch one `general` task with `background: true`. Give it the repository
   path, exact workflow target, selected mode, resolved changeset boundary, and
   applicable repository instructions.
4. In watch mode, require the task to:
   - watch until the target reaches a terminal state;
   - return the run URL or ID, conclusion, and failed job and step details;
   - make no edits.
5. In explicit fix mode, also require the task to:
   - load `changeset-scope`, `diagnose`, and the applicable language or
     framework skills;
   - inspect failed logs and reproduce the exact failing command locally when
     feasible;
   - apply the smallest scoped fix and run the narrowest verification;
   - preserve unrelated worktree changes;
   - return the root cause, files changed, diff summary, verification results,
     and any action still requiring authorisation.
6. Do not poll, sleep, launch a duplicate watcher, or perform overlapping work
   after delegation. OpenCode injects the background task's final result into
   the parent session automatically. Continue only with clearly independent
   work; otherwise report that the watch started and end the turn.
7. When the result arrives, inspect its evidence and any changes before
   reporting them. Do not claim workflows are fixed unless the failing command
   now passes locally or a subsequent authorised workflow run passes.

## Boundaries

- Use a background `task`, not shell backgrounding, `nohup`, tmux, or repeated
  GitHub API polling.
- Background tasks are process-local. Do not tell the user to restart OpenCode
  while a watch is active because the task and its completion result would be
  lost.
- Do not launch a workflow watch from one-shot `opencode run`. The parent
  process exits after the task starts, so the task cannot return its result.
  Use this skill only in a persistent interactive OpenCode session.
- Never infer fix mode from a failing result. A watch-only task reports the
  failure and stops.
- Never commit, push, rerun, cancel, or dispatch a workflow without explicit
  authorisation. Fix mode authorises scoped edits and local verification only.
- If a fix-mode background agent cannot edit because of its permissions, it
  must return a precise patch plan and evidence rather than claiming a fix.
