---
title: Status, Diff & Log
description: Branch status, the diff/repo watcher, and recent commit history.
---

## `dot git-status`

Branch status for the current repository, designed as a single command for agents to get full working-tree and branch context. It prints unstaged files, staged files, and whichever is larger: today's commits or the last 10 commits. The commit heading includes the number shown and whether the list is today's commits, branch commits since the default branch, commits since an explicit `--since` value, or recent commits from the oldest listed commit timestamp. Each commit includes a compact relative timestamp, a pushed/local remote marker, and its changed files inline with `(+added -deleted)` line counts.

```bash
dot git-status                # status summary
dot git-status --diff         # also print full unstaged and staged diffs
dot git-status --branch-diff  # also print the full diff vs the default branch
dot git-status --diff --branch-diff
dot git-status --since "2 days ago"
```

It substitutes running these separately: `git status`, `git diff --stat` / `git diff --numstat`, `git diff --cached --stat`, `git log --oneline --stat`, and `git log @{upstream}..HEAD` (ahead/pushed check). The flags combine. `--branch-diff` measures from the merge base, so committed and uncommitted changes both show, and errors on the default branch where that range is empty. `--since <date>` overrides the default recent-commit window on the default branch or when the default branch ref cannot be resolved; it accepts ISO/RFC dates, epoch timestamps, and relative values such as `2d` or `2 days ago`.

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
