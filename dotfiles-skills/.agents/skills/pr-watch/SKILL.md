---
name: pr-watch
description: >
  Watch a pull request's CI runs, external checks and Copilot or other reviews
  with `dot pr-watch` in an OpenCode 2 background shell, then triage failures
  and validate review threads from its report. Use after pushing to a pull
  request, when asked to watch CI or checks, wait for a Copilot review, or
  follow up on pull request feedback. Read-only on GitHub: drafts replies and
  asks before resolving anything.
license: Apache-2.0
compatibility: Designed for OpenCode 2 background shells. Requires the dot CLI from timmo001/dotfiles, an authenticated GitHub CLI and network access to GitHub.
metadata:
  author: timmo001
---

# PR Watch

`dot pr-watch` polls every workflow run on each pull request's head commit, including the Copilot code review run, plus non-Actions status checks. It prints one line per event and writes failed job logs and the full review dump to a Markdown report. The first and last lines of output give the report path. It never changes the pull request.

## Run

1. Start it with the shell tool's `background: true`, from the pull request's checkout or with `--repo owner/name`. Pass several numbers for a stack, e.g. `dot pr-watch 101 102 103`.
2. Choose when the watch should end:
   - `--stop-on failure` when a quick fix is likely, such as lint, format, types or a unit test in changed code. It exits as soon as a job or check fails, even if other runs are still going.
   - `--stop-on review` to act on review threads before slow suites like end-to-end tests finish.
   - No `--stop-on` when the user wants the full picture: every run finished and requested bot reviews posted.
3. Do not poll while it runs. Carry on with independent work or end the turn. The completion notification carries the summary.
4. Exit codes: `0` everything passed, `1` a failure (or it could not start), `3` stopped early by `--stop-on` with work still pending, `124` timed out. With `3`, the summary lists what is still pending, which helps decide whether to fix now or wait for the review.

After a push moves the head, the running watch follows the new commit. A fresh watch is only needed after it has exited.

## Read the report

Use `Read` offsets or `Grep` on the report path rather than loading it whole when it is large. It contains:

- `### Failed:` sections with the failed steps and the last lines of each failed job's log (use `--log-lines 0` for the whole log).
- For each pull request, reviews listed newest first. Only the latest review from each author has its body shown in full; earlier reviews from the same author are marked superseded, and reviews on older commits are labelled.
- `Open threads`: unresolved threads, with every comment in full and the thread ID.
- `Dismissed threads`: threads that were resolved or minimized, with only the replies shown.

## Triage

- Failures: say whether each is a quick fix in the changed code, needs diagnosis (apply `diagnose`), or looks unrelated, flaky or infrastructure. Propose the fix. Only edit, commit or push when the user asked for that in this task.
- Review threads: check each open thread against the current code under `code-review` and `changeset-scope`, rather than taking it at face value. The latest review takes priority. Outdated threads, and threads from superseded reviews, count for less.
- Dismissed threads are guidance, not absolutes. A resolution with no reply usually means the feedback was addressed. A reply saying won't fix or incorrect means it was dismissed, so don't raise it again unless the problem clearly still exists in the current code.

## Report back

For each open thread, give a verdict (valid, partly valid or invalid) with the evidence:

- Valid: describe the fix. Apply it only if the user asked for fixes.
- Invalid or won't-fix: draft a short reply the user can post, in their voice (apply `writing-style`).

Never post comments, replies or reviews, and never resolve, minimize or react to threads or re-request reviews. When fixes are in place, use the question tool to ask whether any threads should be resolved, and act only on an explicit yes for those specific threads.
