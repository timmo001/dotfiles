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
   - Prefer `--stop-on review` when review feedback is the next thing to act on, before slow suites like end-to-end tests finish. It stops on a newly observed review with open threads; it does not stop for reviews already present at startup or reviews with no open threads.
   - No `--stop-on` when the user wants the full picture: every run finished and requested bot reviews posted.
3. Background output does not automatically prompt the agent for each event. The completion notification carries the summary; `--stop-on failure` can leave review feedback waiting until CI finishes. Do not repeatedly poll while it runs. A one-off read of current output is appropriate when the user asks for progress or it enables useful work now. Read and act on available feedback rather than waiting for unrelated CI; keep the existing watch running for its completion notification. Otherwise, carry on with independent work or end the turn.
4. Exit codes: `0` everything passed, `1` a failure (or it could not start), `3` stopped early by `--stop-on` with work still pending, `124` timed out. With `3`, the summary lists what is still pending, which helps decide whether to fix now or wait for the review.

After a push moves the head, the running watch follows the new commit. A fresh watch is only needed after it has exited.

## Read the report

On completion, read the report, including the full `Open threads` section. A passing CI summary or thread count is not a review triage result. Use `Read` offsets or `Grep` to locate sections rather than loading a large report whole, then read every comment and reply in each open thread. It contains:

- `### Failed:` sections with the failed steps and the last lines of each failed job's log (use `--log-lines 0` for the whole log).
- For each pull request, reviews listed newest first. Only the latest review from each author has its body shown in full; earlier reviews from the same author are marked superseded, and reviews on older commits are labelled.
- `Open threads`: unresolved threads, with every comment in full and the thread ID.
- `Dismissed threads`: threads that were resolved or minimized, with only the replies shown.

The full review dump is appended when the watch exits. While it is running, use a one-off read-only GitHub thread fetch if feedback needs attention now, including threads already present at startup. Fetch all pages and replies. Refresh thread state if later replies or pushes make the report stale; do not turn this into a polling loop.

## Triage

- Failures: say whether each is a quick fix in the changed code, needs diagnosis (apply `diagnose`), or looks unrelated, flaky or infrastructure. Propose the fix. Only edit, commit or push when the user asked for that in this task.
- Review threads: check each open thread against the current code under `code-review` and `changeset-scope`, rather than taking it at face value. Read the whole conversation and compare it with relevant changes already made. Establish separately whether the code addresses the concern, whether someone has answered it, and whether that answer leaves a follow-up. Unresolved does not mean unaddressed; a reply promising a fix does not prove it was implemented. The latest review takes priority. Outdated threads, and threads from superseded reviews, count for less, but still check for unanswered questions or remaining work.
- Dismissed threads are guidance, not absolutes. A resolution with no reply usually means the feedback was addressed. A reply saying won't fix or incorrect means it was dismissed, so don't raise it again unless the problem clearly still exists in the current code.

## Report back

Account for every open thread with a link or thread ID, a short description, and evidence from the current code and replies. Report:

- **Already handled:** what was fixed or answered, with the relevant code, commit or reply. State whether a reply or resolution still remains; do not propose duplicate fixes or answers.
- **Still needs attention:** explicitly list each remaining investigation, code change, unanswered question or reply. Give a verdict (valid, partly valid, invalid or not yet verified), the evidence, and the next action. If none remain, say so after checking all open threads.

For a valid concern, describe the remaining fix and apply it only if the user asked for fixes. Where a reply is still needed, draft it in the user's voice (apply `writing-style`), including explanations of completed fixes or invalid/won't-fix feedback. Do not repeat an existing answer unless new information needs a response. Keep pending CI separate from thread follow-up, so passing checks do not imply the discussion is finished.

Never post comments, replies or reviews, and never resolve, minimize or react to threads or re-request reviews. When fixes are in place, use the question tool to ask whether any threads should be resolved, and act only on an explicit yes for those specific threads.
