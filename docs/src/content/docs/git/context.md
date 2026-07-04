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
| `--no-branch-metadata` | on | Omit the branch metadata block. |
| `--no-status` | on | Omit the working-tree status block. |
| `--no-work-scope` | on | Omit the branch work-scope aggregates. |
| `--diff` | off | Append the full unstaged and staged diffs beneath their sections. |
| `--branch-diff` | off | Append the merge-base diff vs the default branch; errors on the default branch. |
| `--since <date>` | today or last 10 | Override the recent-commit window on the default/recent path. |

The review decision and comment count are part of the always-on PR summary, so they need no flag. On the default branch the PR block is skipped regardless of `--no-pr`. Flags combine freely, for example `dot git-context --json --comments --reviews --labels --checks` is what the branch-context plugin runs.

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
