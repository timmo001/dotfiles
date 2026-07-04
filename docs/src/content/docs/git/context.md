---
title: Context, Diff & Log
description: Branch context, the diff/repo watcher, and recent commit history.
---

## `dot git-context`

Branch context for the current repository, designed as a single command for agents to get full working-tree and branch context, and as the shared producer for the OpenCode branch-context plugin (via `--json`). It prints repository identity, branch/base, HEAD, ahead/behind state, the pull request for a feature branch, unstaged files, staged files, untracked files, branch changed files, and whichever is larger: today's commits or the last 10 commits. The commit heading includes the number shown and whether the list is today's commits, branch commits since the default branch, commits since an explicit `--since` value, or recent commits from the oldest listed commit timestamp. Each commit includes a compact relative timestamp, a pushed/local remote marker, and its changed files inline with `(+added -deleted)` line counts.

On a feature branch the pull request summary is always shown (via `gh pr view`): number, state, title, comment count, review decision, mergeability, draft state, branches, and URL, plus the description. The lookup is resilient: it is skipped on the default branch and omitted when `gh` is missing, no PR exists, or the request fails. Add `--comments`, `--reviews`, `--labels`, or `--checks` to include those sections (`--checks` makes a second `gh` call); `--no-description` or `--no-pr` trim the PR block.

```bash
dot git-context                     # context summary
dot git-context --comments --reviews # include PR comments and reviews
dot git-context --labels --checks   # include PR labels and CI checks
dot git-context --remotes           # include remote fetch/push URLs
dot git-context --diff              # also print full unstaged and staged diffs
dot git-context --branch-diff       # also print the full diff vs the default branch
dot git-context --json              # structured branch-context payload (plugin format)
dot git-context --since "2 days ago"
```

### Text output and colour

Plain text is the default output. On an interactive TTY, `dot git-context` colours headings, PR labels, warning lines, hint commands, and the pushed/local commit markers to make the scan path clearer:

- section headings such as `Branch:`, `Unstaged:`, `Staged:`, and `Diff vs ...` are bold cyan;
- PR metadata labels such as `State:`, `Review decision:`, and `URL:` are bold;
- pushed commits show a green `✓`; local-only commits show a dim `↑`;
- trailing hint commands such as `dot git-context --branch-diff` are green.

Automation remains plain by design. Piped output, redirects, captured agent context, and the MCP branch-context layer use the same text without ANSI escape codes. Set `NO_COLOR` to any non-empty value to force plain text even on a TTY:

```bash
dot git-context > context.txt
NO_COLOR=1 dot git-context
```

`--json` always emits the structured branch-context payload without terminal styling.

It substitutes running these separately: `git status`, `git diff --stat` / `git diff --numstat`, `git diff --cached --stat`, `git log --oneline --stat`, and `git log @{upstream}..HEAD` (ahead/pushed check). The flags combine. `--branch-diff` measures from the merge base, so committed and uncommitted changes both show, and errors on the default branch where that range is empty. `--since <date>` overrides the default recent-commit window on the default branch or when the default branch ref cannot be resolved; it accepts ISO/RFC dates, epoch timestamps, and relative values such as `2d` or `2 days ago`.

`--json` emits the structured branch-context payload consumed by the OpenCode branch-context plugin instead of text; the `--no-*` section flags control which blocks it carries.

### Flags

The pull request summary and description are on by default on a feature branch; comments, reviews, labels, checks, remote URLs, and full diffs are opt-in. The `--no-*` flags trim sections from both text and `--json`.

| Flag | Default | Notes |
| --- | --- | --- |
| `--json` | off (text) | Emit the structured branch-context payload (plugin format) instead of text. |
| `--comments` | off | Include the PR conversation comments (fetched in the same `gh pr view` call). |
| `--reviews` | off | Include individual PR reviews (reviewer, state, body). |
| `--labels` | off | Include the PR labels. |
| `--checks` | off | Include CI check runs; makes a second `gh pr checks` call. |
| `--no-description` | description on | Omit the PR description/body. |
| `--no-pr` | PR on (feature branch) | Omit the PR block entirely; use for branch-only context. |
| `--remotes` | off | Include remote fetch/push URLs in branch metadata. |
| `--no-branch-metadata` | off (section included) | Omit the branch metadata block. |
| `--no-status` | off (section included) | Omit the working-tree status block. |
| `--no-work-scope` | off (section included) | Omit the branch work-scope aggregates. |
| `--diff` | off | Append the full unstaged and staged diffs beneath their sections. Text output only; ignored with `--json` (prints a stderr warning). |
| `--branch-diff` | off | Append the merge-base diff vs the default branch; errors on the default branch. Text output only; ignored with `--json` (prints a stderr warning). |
| `--since <date>` | today or last 10 | Override the recent-commit window on the default/recent path. |

The review decision and comment count are part of the always-on PR summary, so they need no flag. On the default branch the PR block is skipped regardless of `--no-pr`. Flags combine freely, for example `dot git-context --json --comments --reviews --labels --checks` is what the branch-context plugin runs.

### OpenCode branch-context plugin

The OpenCode [`branch-context`](/reference/plugins/) plugin is a thin consumer of `dot git-context --json`. It runs once per eligible slash command (on the `command.execute.before` hook), then injects a `<branch-context>` XML block into the prompt so agents do not re-run `git`/`gh` for scope.

Two injection tiers:

| Tier | `dot git-context` invocation | XML sections |
| --- | --- | --- |
| Full branch context | `--json --labels --comments --reviews --checks` | `<branch-metadata>`, `<status>`, `<work-scope>`, `<pull-request>`, `<warnings>` |
| Work scope only | `--json --no-pr` | `<branch-metadata>`, `<status>`, `<work-scope>`, `<warnings>` |

Full-context commands include `/review-current-work`, `/refactor-current-work`, `/inject-context`, and `/reset-branch-reapply`. Work-scope commands include scoped refactor and skill-routing commands that only need changed files (see the plugin source for the current command list). Commands that depend on injected context should follow the [`branch-context-consumer`](/reference/skills/) skill: use the precomputed `<work-scope>` block instead of rebuilding scope with separate git calls.

On the default branch, `<work-scope>` reports that branch scope is skipped and lists recent commits instead of branch-only changes, so injected context still carries history when there is no feature branch.

### JSON payload (`--json`)

`--json` emits one structured snapshot from the same producer as the text output. The OpenCode plugin parses this payload and renders XML; the MCP server and other automation can consume it directly.

Top-level fields:

| Field | When present | Purpose |
| --- | --- | --- |
| `inRepo` | always | `false` when the cwd is not inside a git worktree |
| `branchMetadata` | default on | Repository root, branch, HEAD, remotes, ahead/behind, base ref |
| `status` | default on | Compact `git status -sb` plus unstaged, staged, and untracked name-status lists |
| `workScope` | default on | Branch-only commits, changed files, and diff stat vs the default branch |
| `commits` | default branch only | Recent commits (marker, hash, relative time, subject), included when branch scope is skipped |
| `pullRequest` | feature branch, unless `--no-pr` | PR summary plus any opt-in detail sections |
| `warnings` | always | Non-fatal collection issues (missing `gh`, fetch failure, truncation) |

The text renderer prints a recent-commits section (today's window, branch-unique commits, or `--since`) with per-commit timestamps, push markers, and inline file stats. On a feature branch that history is the `workScope.branchCommits` list, so the payload omits the standalone `commits` field. On the default branch, where branch scope is skipped, the payload adds a compact `commits` block (pushed/local marker, hash, relative time, subject) so injected context still carries recent history. Full working-tree and merge-base diffs (`--diff`, `--branch-diff`) remain text-only and are never serialised into JSON; combining them with `--json` prints a stderr warning and is otherwise ignored.

Large text blocks are truncated in the JSON renderer so prompt size stays bounded. Overflow appends `[TRUNCATED N CHARS]`:

| Block | Character limit |
| --- | --- |
| `status.short` | 12,000 |
| `status.*` file lists, `workScope.branchFiles` | 30,000 each |
| `workScope.branchCommits` | 30,000 |
| `workScope.branchDiffStat` | 20,000 |
| `pullRequest.checks` | 40,000 |

Use `--no-branch-metadata`, `--no-status`, or `--no-work-scope` to omit sections from both text and JSON.

### Agent workflow

For agents and harnesses:

1. Prefer `dot git-context` (or the MCP `git_context` tool) over separate `git status`, `git diff`, and `gh pr view` calls.
2. When OpenCode injects `<branch-context>`, treat it as the primary source; do not rebuild scope unless the user asks for a fresh snapshot.
3. Use `--diff` or `--branch-diff` when file lists are not enough; use `--json` only when you need the structured payload (plugin format or programmatic parsing).
4. Piped, redirected, and MCP output is always plain text without ANSI colour. Set `NO_COLOR=1` to force plain text on a TTY.

## `dot git-diff`

The diff / repo watcher view. Without flags it opens the interactive TUI showing managed repos with changes, including fetched unpushed/incoming commit checks. The alias `dot diff` remains for compatibility.

```bash
dot git-diff                # interactive TUI
dot git-diff --raw          # text summary of repos with changes
dot git-diff --bar-json     # JSON for status bars and shell modules
dot git-diff --tab other    # focus the Other pane in the TUI
dot git-diff --list-changed # changed repos as name|path rows
dot git-diff --list-all     # all tracked repos as name|path rows
```

Press Enter on a repo to launch [lazygit](https://github.com/jesse-duffield/lazygit) via suspend/resume.

## `dot git-log`

Recent commit history across the same tracked repos as `dot git-diff`, sorted by latest commit activity.

```bash
dot git-log         # interactive TUI
dot git-log --raw   # text summary of recent commits
```
