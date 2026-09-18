---
description: Reset a clean feature branch to its base and reapply its committed changes staged
agent: build
---

Load `branch-context-consumer` in full-context mode and `git-context`. Require an unambiguous base ref from `<branch-metadata>`; do not guess `main` or continue when injection failed.

This rewrites the current branch. Before acting:

- Inspect fresh working-tree state, including staged, unstaged, untracked, and submodule changes. Stop if any exist; also stop if an ignored file would be overwritten by the base tree. Do not stash or discard files automatically.
- Require a named feature branch distinct from the default branch. Stop for detached HEAD or an in-progress Git operation.
- Resolve the base and current HEAD to exact commit IDs. Require the base to be an ancestor of HEAD; otherwise a rebase needs separate conflict handling.

Save `git diff --binary --full-index <base-commit>...<head-commit>` to a unique temporary file. Verify the write succeeded and the patch is non-empty. Create a uniquely named local backup branch at the original HEAD and verify it before resetting.

Immediately before resetting, confirm HEAD and the clean working-tree state have not changed. Reset to the resolved base commit, run `git apply --check --index <patch>`, then `git apply --index <patch>`. Stop on any failure and retain the patch and backup ref for recovery. Never reset a second time as an automatic fallback.

Verify the staged tree matches the original HEAD tree, then report the staged result, backup ref, and patch path. Do not commit or push.
