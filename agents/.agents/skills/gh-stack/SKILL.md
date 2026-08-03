---
name: gh-stack
description: Manage stacked branches and pull requests with GitHub's `gh stack` extension. Use when work involves stacked PRs, dependent branches, stack creation, navigation, submission, synchronisation, rebasing, restructuring, linking, or merging.
# origin: https://github.com/github/gh-stack/tree/main/skills/gh-stack
# upstream-sha: 68ce60c76096c1aecdc19a8af6fa7e89d31ebc2b
# local-edits:
#   - SKILL.md: condensed upstream reference and replaced commit, push, PR description, rewrite, and merge instructions with local authorisation and gateway rules
---

# GitHub Stacks

Use GitHub's official `gh stack` extension for linear stacks of dependent
branches and pull requests. Each branch builds on the branch below it, and each
pull request targets that immediate parent so reviewers see one layer's diff.

Load `git-context` for branch and rebase operations. Load `git-commit` only
after the user explicitly requests a commit or push.

## Safety And Authorisation

- Inspect with `gh stack view --json` before and after every mutation.
- Do not commit through `gh stack add -m`, `-A`, or `-u`, and never run raw
  `git commit`. Commit only after explicit authorisation through
  `dot git-commit`, following the `git-commit` skill.
- Treat `push`, `submit`, `sync`, and branch arguments passed to `link` as push
  operations. Run them only when the user explicitly authorises that push.
- `submit` and `link` can create pull requests and generate or change titles,
  descriptions, and base branches. Obtain explicit consent for those specific
  PR changes before running them; permission to create a PR alone does not
  authorise its description.
- Treat `rebase`, `modify`, `unstack`, and rebuilding local tracking as history
  or stack-structure rewrites. Run them only when requested or when the user
  approves the explained recovery operation.
- Run `merge` only after explicit merge authorisation for the named stack or PR
  range. Never infer merge permission from approval to push or submit.
- Preserve unrelated worktree changes. Structural operations require a clean
  tree; do not stash, discard, or absorb user changes without permission.
- Never use plain force push. Stack pushes use per-branch
  `--force-with-lease`; stop if a lease is rejected.

## Agent-Safe Operation

Avoid commands that open prompts or TUIs:

- Use `gh stack view --json`, never bare `view` or `view --short`.
- Give branch names to `init` and `add`.
- Give a stack number, PR number, PR URL, or branch to `checkout`.
- Do not run interactive `modify`. Explain the intended structure and use the
  explicit non-interactive recovery path only after approval.
- If multiple remotes exist, pass `--remote <name>` where supported. Do not
  change `remote.pushDefault` merely to avoid a prompt.

The extension must be installed and authenticated:

```bash
gh extension install github/gh-stack
gh stack --help
```

Installation is a separate system change and requires the user's request or
approval. Verify command flags against live help because `gh stack` is in
public preview.

## Choose The Right Operation

| Intent | Command | Important effect |
| --- | --- | --- |
| Inspect local stack | `gh stack view --json` | Read-only |
| Start/adopt local tracking | `gh stack init --base <trunk> <branches...>` | Creates/adopts branches |
| Add a top layer | `gh stack add <branch>` | Creates and checks out a branch |
| Navigate | `gh stack up`, `down`, `top`, `bottom`, `trunk` | Changes checkout |
| Check out known stack | `gh stack checkout <target>` | Fetches remote stack when target is a stack/PR |
| Push tracked branches | `gh stack push --remote <remote>` | Pushes active branches with leases |
| Create/update PR stack | `gh stack submit --auto --remote <remote>` | Pushes, creates/updates PRs and remote stack |
| Routine reconciliation | `gh stack sync --remote <remote>` | Fetches, may rebase, pushes, and updates remote stack |
| Cascade history | `gh stack rebase [--upstack|--downstack]` | Rewrites stack branch history |
| Link externally managed branches/PRs | `gh stack link ...` | Remote-only tracking; may push/create/retarget PRs |
| Restructure | `gh stack modify` | Interactive; do not drive as an agent |
| Remove tracking/grouping | `gh stack unstack [--local]` | Removes local and optionally remote stack state |
| Merge | `gh stack merge <stack-or-pr> --yes <method>` | Merges an authorised prefix or stack |

`link` does not establish local stack tracking. Use it for branches managed by
another tool or when the user explicitly wants remote-only linking. Use
`init`/`submit` for a locally managed stack.

## Build A Stack

1. Plan one coherent story in dependency order. Foundational changes belong
   below their consumers; unrelated work belongs in another stack.
2. Confirm the worktree and branch context, then initialise with explicit
   branch names:

   ```bash
   gh stack init --base <trunk> <bottom-branch> [higher-branches...]
   ```

3. Implement and verify one independently reviewable layer at a time.
4. When authorised to commit, use `dot git-commit` on the exact paths.
5. Add the next branch from the current top:

   ```bash
   gh stack add <next-branch>
   ```

6. When the user separately authorises pushing and the generated PR metadata,
   submit non-interactively, then verify:

   ```bash
   gh stack submit --auto --remote <remote>
   gh stack view --json
   ```

New PRs created with `--auto` default to draft unless `--open` is supplied.
Do not use `--open` unless the user asks to mark them ready for review.

## Fix A Lower Layer

Make a correction on the branch that owns it, not as an upstack workaround:

1. Navigate to the owning branch with `down`, `bottom`, or explicit
   `checkout`.
2. Make and verify the correction.
3. Commit only through the authorised `dot git-commit` workflow.
4. With approval to rewrite the upstack branches, run:

   ```bash
   gh stack rebase --upstack
   ```

5. With separate push authorisation, run `gh stack push`, then verify with
   `gh stack view --json`.

## Synchronise And Recover

`gh stack sync` performs fetch, reconciliation, possible cascading rebase,
push, PR-state sync, and remote-stack sync. It is not a read-only status check.
Use it only with explicit push and rewrite authorisation.

After a squash merge, `sync` can replay remaining branches onto the updated
trunk. If it reports a conflict, it restores the branches and exits with code
3. Then use the explicit rebase workflow:

```bash
gh stack rebase
# resolve files and stage only the resolutions
gh stack rebase --continue
# or restore the pre-rebase state
gh stack rebase --abort
```

Follow `git-context` for conflict resolution. Do not use raw interactive rebase
continuation or editor workarounds when the extension owns the operation.

If local and remote stack composition diverge, stop and present the actual
local/remote chains. Do not automatically choose the remote, delete the remote
stack, or unstack. Those choices can discard tracking decisions.

## Restructure Without The TUI

When a stack must be reordered, inserted into, renamed, folded, or have a layer
removed:

1. Show the current `view --json` state and the proposed final branch order.
2. Obtain explicit approval for local/remote unstacking and history rewrites.
3. Use `gh stack unstack` (or `--local` when preserving GitHub grouping).
4. Recreate local tracking with explicit ordered branches:

   ```bash
   gh stack init --base <trunk> <bottom> <middle> <top>
   ```

5. Rebase as needed, then obtain explicit push and PR-metadata consent before
   `submit --auto`.
6. Verify branch order, heads, bases, and PR associations with
   `gh stack view --json`.

## Merge

Before merging, verify every selected PR and every layer below it is open,
non-draft, approved, current, and passing required checks. Then require an
explicit stack number or PR endpoint and merge method:

```bash
gh stack merge <stack-number-or-pr-number> --yes --squash
```

Without a merge queue, the selected range is all-or-nothing. With a merge
queue, the PRs are enqueued together but may land in separate groups, and the
queue chooses the merge method.

## Exit Codes

| Code | Meaning | Response |
| --- | --- | --- |
| 2 | Not in a stack | Inspect context; initialise only when requested |
| 3 | Rebase conflict | Resolve and `rebase --continue`, or abort |
| 4 | GitHub API failure | Report authentication/API failure; do not guess |
| 5 | Invalid arguments | Check live help |
| 6 | Branch belongs to multiple stacks | Check out a non-shared branch explicitly |
| 7 | Rebase already in progress | Continue or abort the existing operation |
| 8 | Stack locked | Stop; another process owns the stack |
| 9 | Stacked PRs unavailable | Report repository/platform availability |
| 10 | Interrupted `modify` | Run `modify --abort` only with recovery approval |

## Limitations

- Stacks are linear and all branches must live in the same repository.
- `link` is additive and does not remove existing PRs from a remote stack.
- Branch arguments to `link` may be pushed automatically.
- `submit` generates PR titles and descriptions; edit them only with separate,
  specific user consent.
- `push` and `submit` are not atomic across every branch. Inspect partial
  success before retrying.
- GitHub's server-side rebase can create unsigned commits. Use the local
  extension workflow when signed commits are required.
