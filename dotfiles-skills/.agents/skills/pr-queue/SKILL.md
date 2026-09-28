---
name: pr-queue
description: >
  Find reviewable pull requests and catch up on what was merged, closed or
  opened in a repository with `dot pr-queue`, then rank or summarise them the
  way the user wants. Use when asked which pull requests are reviewable, why the
  open pull request count changed, what to review next, or what happened or was
  missed over a period such as today, yesterday or the weekend. Read-only.
license: Apache-2.0
compatibility: Requires the dot CLI from timmo001/dotfiles, an authenticated GitHub CLI and network access to GitHub. The default review search comes from private dot-git.yml.
metadata:
  author: timmo001
---

# PR Queue

`dot pr-queue` runs the repository's saved review search (`review_search` in private `dot-git.yml`, or `--search`) and lists the matching pull requests, along with every pull request merged, closed without merging or opened since `--since`. For "reviewable PRs", `--reviewable` searches all open non-draft PRs except those labelled `wait for backend`, `Do Not Review`, or `has-parent`, regardless of assignment, author or prior review. It includes PR descriptions, recent comments and review-thread text in the same paginated query. The command provides evidence for judgement, not a verdict that each result is ready. It never changes anything on GitHub.

## Ask how to present it

Unless the request already makes it clear, use the question tool once before presenting. Offer:

- **Ranked for review (recommended when the user wants to review):** small, medium, large and not ready, with a short note per pull request and quick wins called out.
- **What happened:** merged, closed and opened in the window, grouped by theme or area, for catch-up questions.
- **Newest or recently updated first:** one list, for scanning what moved.
- **By author or area:** for spotting related pull requests or series.

Remember the answer for the rest of the conversation.

## Run

1. Map the request to flags:
   - The window: `--since today` (default), `yesterday`, a date such as `2026-09-19` (local midnight), an ISO timestamp, or an age such as `12h`, `3d` or `1w`. For "the weekend", work out the date of the most recent Saturday and pass it, or Friday evening as a timestamp if the user means after work.
   - `--only activity` for catch-up questions, `--only queue` for review-only questions; omit it for both.
   - `--sort effort` (default), `updated`, `created` or `size` to match the chosen presentation.
   - For "reviewable PRs" or "what should I review", use `--only queue --reviewable --json` in one call, not the narrower private `review_search`. Use `--repo owner/name` outside the checkout. For a specifically requested filter, pass `--search`; if no saved search exists for other queue requests, ask for one.
2. Use the Markdown output directly, or `--json` when regrouping or joining with other data. Check `queue.total` against `queue.listed`; if the reviewable pool was cut off by the default 200-PR limit, rerun with `--limit` large enough to include it before saying the search is complete. Avoid separate `gh pr view` calls for comment text already in the reviewable result.

## Look further

The command's groups are a starting point. Before calling something a quick win, or when the user asks about a specific pull request, check what the numbers cannot show:

- Reviewable results already contain recent PR comments and unresolved thread bodies. Read both before ranking; a maintainer's "on hold" comment can block a PR with passing checks and no open threads. Judge thread findings against the current diff under `code-review`: a genuine unaddressed concern (a bug, a wrong assumption, a missing guard, a contract mismatch) means it is not a quick win. Outdated does not necessarily mean fixed; verify the changed code. For the narrower saved search, rerun once with `--only queue --threads` if open threads need reading.
- The reviewable search excludes known backend waits and parent dependencies, not `Needs UX` or `Blocked`. Put UX-labelled PRs in a separate UX-review group only when a decision is actually sought; exclude holds, outstanding change requests, failing checks and already-approved PRs from ordinary code-review picks. Label-only blocking checks do not prevent a PR from being considered for UX review. Do not pad the list with work awaiting a dependency or the author's changes.
- `recentComments` contains at most the ten latest general comments; `comments` is the full count. If a candidate has older comments omitted and its status is unclear, look up that PR specifically. Comment or thread absence is not proof that a PR is correct.
- Read the diff (`gh pr diff`) for risk: shared components, login or auth, data handling, public APIs, many small edits across files.
- Labels or failing checks that mean it's waiting on the author, such as a missing template or a blocked label, even when the size is small.
- Check `body` for links between pull requests (series from the same author, drafts it depends on), and whether it probably needs UX or backend input.
- For merged pull requests in catch-up answers, say what changed for users or maintainers, not only the title. The window catches merges that are easy to miss in the commit list, such as squashed or quickly merged pull requests.

Keep claims tied to evidence: say when a note comes from the diff, the description, or only the metadata.

## Report back

- Lead with the answer to the question asked (the count change, the top picks, or what happened), then the list in the chosen presentation. If only a few code-review picks remain after checking all open non-drafts, say why rather than presenting the private saved search as the entire pool.
- Keep the time window the user asked about, or set earlier in the conversation, such as "today". The review queue lists every open match whatever its age, so say plainly which picks are from that window and which are older, using the Opened and Updated dates and the `new`/`updated` notes, for example "opened 17 Sep, not today". If nothing in the window fits, say so before offering older ones.
- Link each pull request and include its author and size.
- Offer the next step, such as reviewing a specific pull request, without starting it. Never comment, review, approve, label or merge.
