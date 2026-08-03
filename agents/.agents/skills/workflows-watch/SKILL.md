---
name: workflows-watch
description: Watch GitHub Actions workflows in an experimental background task and return the result. Use when asked to watch checks, wait for workflows, or follow workflow runs without blocking the main agent; diagnose and fix only when the caller explicitly requests fix mode.
---

# Workflows Watch

Delegate GitHub Actions waits to experimental background tasks so the main
agent does not block on foreground `gh` watches.

## Modes

- **Watch mode is the default.** Wait for the workflow target, then return its
  terminal result and failed job details without editing files.
- **Fix mode is explicit.** Enter it only when the user or calling workflow
  clearly asks to diagnose and fix failures. `/fix-workflows` and the
  post-push `git-commit` cycle opt into this mode. Code review stays in watch
  mode unless the user separately asks for a fix.
- **Fail-fast fix mode is for post-push feedback.** Pair it with a separate
  watch-only task for full validation. The fix task exits on the first failed
  quick check or when all selected quick checks pass; the full task continues
  watching builds, E2E tests, and slower checks. Only the fail-fast task may
  edit.

## Workflow

1. Resolve the repository, branch, pull request, workflow run, and current
   working-tree scope before delegation. Record the exact pushed commit SHA so
   the task cannot attach to an older run. Use an explicit matching run ID when
   available; otherwise have the task discover or watch the pull request checks
   for that SHA.
2. Check live CLI help before selecting the watch command. Prefer:
   - `gh run watch <run-id> --compact --exit-status --interval 10`
   - `gh pr checks <pr> --watch`
3. Launch a `general` task with `background: true`. Give it the repository
   path, exact workflow target, selected mode, resolved changeset boundary, and
   applicable repository instructions. For post-push fix cycles, launch two
   tasks concurrently:
   - a fail-fast fix task for an explicit quick-check set, pinned to the exact
     pushed SHA;
   - a bounded full watch-only task for all checks on that SHA.
   Resolve the quick-check set from the repository's actual workflows and jobs
   before delegation. Include lint, formatting, static analysis, type checks,
   and similarly fast unit checks. Exclude builds, E2E tests, deployments, and
   jobs that depend on the slow validation path. Give the task the selected
   check names; do not make it infer them while watching.
4. In watch mode, require the task to:
   - watch until the target reaches a terminal state;
   - return the run URL or ID, conclusion, and failed job and step details;
   - make no edits.
5. In explicit fix mode, also require the task to:
   - load `changeset-scope`, `diagnose`, and the applicable language or
     framework skills;
   - inspect failed logs and reproduce the exact failing command locally when
     feasible;
   - immediately before editing, compare the affected files with the state at
     delegation; if they changed, incorporate the newer work only when the fix
     remains unambiguous, otherwise return the diagnosis and patch direction
     without editing;
   - apply the smallest scoped fix and run the narrowest verification;
   - preserve unrelated worktree changes;
   - return the root cause, files changed, diff summary, verification results,
     and any action still requiring authorisation.
   In fail-fast fix mode, inspect only the selected quick checks and stop
   successfully without edits when they all pass. Do not wait for or duplicate
   the full task's final report.
6. Do not poll, sleep, or launch a duplicate watcher after delegation. OpenCode
   injects the background task's final result into the parent session
   automatically. The parent may continue normal edits, including overlapping
   files; the pre-edit freshness check keeps the fail-fast fixer from
   overwriting newer work. Report that the watches started, then continue or
   end the turn according to the user's remaining request.
7. When the result arrives, inspect its evidence and any changes before
   reporting them. Do not claim workflows are fixed unless the failing command
   now passes locally or a subsequent authorised workflow run passes.

## Boundaries

- Use a background `task`, not shell backgrounding, `nohup`, tmux, or repeated
  GitHub API polling.
- Background tasks are process-local. Do not tell the user to restart OpenCode
  while a watch is active because the task and its completion result would be
  lost.
- Do not launch workflow watches from one-shot `opencode run`. The parent
  process exits after the task starts, so the task cannot return its result.
  Use this skill only in a persistent interactive OpenCode session.
- Never infer fix mode from a failing result. A watch-only task reports the
  failure and stops.
- Never give both post-push tasks fix ownership. The full validation task stays
  watch-only even when it reports a late failure.
- Workflow watches do not lock the worktree or block subsequent edits, commits,
  or other user-requested work. Existing authorisation rules still apply to
  those actions.
- Bound every watch. Use 15 minutes for the quick-check task and 45 minutes for
  full validation unless repository evidence requires a different limit. On
  timeout, return the checks still pending and their URLs without treating them
  as failures.
- Never commit, push, rerun, cancel, or dispatch a workflow without explicit
  authorisation. Fix mode authorises scoped edits and local verification only.
- If a fix-mode background agent cannot edit because of its permissions, it
  must return a precise patch plan and evidence rather than claiming a fix.
