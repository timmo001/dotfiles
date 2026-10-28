---
name: dot-pr-watch
description: >
  Watch a pull request's CI, checks and Copilot or other reviews with
  `dot pr watch`, then triage failures and validate review findings. Use after
  pushing to a pull request or when asked to watch CI or follow up on review
  feedback.
license: Apache-2.0
compatibility: Designed for OpenCode 2 Code Mode tools or background shells. Requires the dot CLI from timmo001/dotfiles, an authenticated GitHub CLI and network access to GitHub.
metadata:
  author: timmo001
---

# PR Watch

`dot pr watch` polls every workflow run on each pull request's head commit, including the Copilot code review run, plus non-Actions status checks. It prints one line per event and writes failed job logs and the full review dump to a Markdown report. The first and last lines of output give the report path. It never changes the pull request.

## Run

1. Choose how to run it:
   - Prefer the `dot` Code Mode namespace's `pr_watch` tool when the agent has it and the wait is short enough to block on, typically with `stopOn` and a `timeout` of a few minutes up to about 20. The call blocks until the watch ends and returns the outcome, `exitCode`, open threads, review body findings and the report path. Run independent watches in one `execute` with `Promise.allSettled`. A `124` here only means the bounded wait ended; call it again to wait for the next stop point.
   - Otherwise, or for long waits such as a full run with slow end-to-end suites, run `dot pr watch` with the shell tool's `background: true`, so the agent can carry on meanwhile.

   Run from the pull request's checkout or pass the repository (`repo`, `--repo owner/name`). For independent pull requests, start one watch per pull request. A watch over several pull requests shares one stop condition (feedback on any of them stops all) and only completes once every one has settled. Pass several numbers only for a stack, e.g. `dot pr watch 101 102 103`, or when watching without a stop condition for the full picture.
2. Choose when the watch should end (`stopOn` in the tool, `--stop-on` on the CLI):
   - `failure` when a quick fix is likely, such as lint, format, types or a unit test in changed code. It exits as soon as a job or check fails, even if other runs are still going.
   - Prefer `review` when review feedback is the next thing to act on, before slow suites like end-to-end tests finish. Reviews are fetched alongside CI, so it exits within seconds when an open thread at startup is current and unanswered (not outdated, no replies). Otherwise it stops on a newly observed review with open threads or review body findings; it does not stop for answered or outdated threads already present, so a watch started after pushing fixes still follows CI.
   - Neither when the user wants the full picture: every run finished and requested bot reviews posted.
3. A background shell does not prompt the agent for each event. The completion notification carries the summary; `--stop-on failure` can leave review feedback waiting until CI finishes. Do not repeatedly poll while it runs. A one-off read of current output is appropriate when the user asks for progress or it enables useful work now. Read and act on available feedback rather than waiting for unrelated CI; keep the existing watch running for its completion notification. Otherwise, carry on with independent work or end the turn.
4. Exit codes: `0` everything passed, `1` a failure (or it could not start), `3` stopped early with work still pending, `124` timed out. With `3`, the summary lists what is still pending, which helps decide whether to fix now or wait for the review.

After a push moves the head, a running watch follows the new commit. A fresh watch is only needed after it has exited.

## Read the report

On completion, read the report, including the full `Review body findings` and `Open threads` sections and the latest review body from each reviewer. A passing CI summary or thread count is not a review triage result. Use `Read` offsets or `Grep` to locate sections rather than loading a large report whole, then read every comment and reply in each open thread. It contains:

- `### Failed:` sections with the failed steps and the last lines of each failed job's log (use `--log-lines 0` for the whole log).
- For each pull request, reviews listed newest first. Only the latest review from each author has its body shown in full; earlier reviews from the same author are marked superseded, and reviews on older commits are labelled.
- `Review body findings`: findings that exist only in a review body, with no thread. Copilot puts findings it can't comment on inline, often in code the pull request didn't change, in collapsed sections such as "previously missed issue" or "Comments suppressed due to low confidence". The tool extracts Copilot's; check other reviewers' bodies by hand for findings or questions without a thread.
- `Open threads`: unresolved threads, with every comment in full and the thread ID.
- `Dismissed threads`: threads that were resolved or minimized, with only the replies shown.

The full review dump is appended when the watch exits. While it is running, read the reviews once (same PR numbers and repository) if feedback needs attention now, including threads already present at startup: prefer the `dot` Code Mode namespace's `pr_reviews` tool, and fall back to `dot pr reviews` without it. It returns the same review dump, with every page and reply. Read it again if later replies or pushes make the report stale; do not turn this into a polling loop.

## Triage

- Failures: say whether each is a quick fix in the changed code, needs diagnosis (apply `diagnose`), or looks unrelated, flaky or infrastructure. Propose the fix. Only edit, commit or push when the user asked for that in this task.
- Review threads: check each open thread against the current code under `code-review` and `changeset-scope`, rather than taking it at face value. Read the whole conversation and compare it with relevant changes already made. Establish separately whether the code addresses the concern, whether someone has answered it, and whether that answer leaves a follow-up. Unresolved does not mean unaddressed; a reply promising a fix does not prove it was implemented. The latest review takes priority. Outdated threads, and threads from superseded reviews, count for less, but still check for unanswered questions or remaining work.
- Review body findings: triage each like an open thread. With no thread to show a reply or resolution, check the pull request's comments and later commits for an answer or fix.
- Dismissed threads are guidance, not absolutes. A resolution with no reply usually means the feedback was addressed. A reply saying won't fix or incorrect means it was dismissed, so don't raise it again unless the problem clearly still exists in the current code.

## Report back

Account for every open thread and review body finding with a link (thread ID, or the review URL for a body finding), a short description, and evidence from the current code and replies. Report:

- **Already handled:** what was fixed or answered, with the relevant code, commit or reply. State whether a reply or resolution still remains; do not propose duplicate fixes or answers.
- **Still needs attention:** explicitly list each remaining investigation, code change, unanswered question or reply. Give a verdict (valid, partly valid, invalid or not yet verified), the evidence, and the next action. If none remain, say so after checking all open threads and review body findings.

For a valid concern, describe the remaining fix and apply it only if the user asked for fixes. Where a reply is still needed, draft it in the user's voice (apply `writing-style`: no "Good catch" or other stock pleasantries, only the fix or the reason), including explanations of completed fixes or invalid/won't-fix feedback. A review body finding has no thread, so draft its reply as a pull request comment that links the review and names the finding. Do not repeat an existing answer unless new information needs a response. Keep pending CI separate from thread follow-up, so passing checks do not imply the discussion is finished.

Never post comments, replies or reviews, and never resolve, minimize or react to threads or re-request reviews. When fixes are in place, ask (see `asking-questions`) whether any threads should be resolved, and act only on an explicit yes for those specific threads. Resolve them with the `gh` Code Mode namespace's `review_thread_resolve` when the agent has it, otherwise through `gh api graphql`.
