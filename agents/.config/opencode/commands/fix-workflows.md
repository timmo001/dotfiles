---
description: Diagnose and fix recent GitHub Actions failures, optionally scoped to a workflow or run
---

Load the `diagnose` skill before proceeding.

Use `${ARGUMENTS}` as an optional workflow name, workflow file, run ID, job name, or GitHub Actions URL. If it is empty, inspect recent failed workflow runs for the current repository and branch. Do not ask for a target unless multiple unrelated failures make the intended scope materially ambiguous.

Use the Context MCP server's `git_context` tool to identify the current repository, branch, remotes, and working-tree state. Prefer the GitHub Actions MCP tools for concise run, job, and failed-log reads. Use `gh` only when the MCP tools cannot express the required lookup or for a compact long-running watch.

Identify the failing workflow, job, step, and exact error before editing. Build and run the smallest local reproduction of the failing command where feasible, then trace the failure to its root cause. If the failure comes from a reusable workflow, load the `shared-workflows` skill and inspect the referenced workflow before deciding which repository should change.

Make the smallest correct fix while preserving unrelated working-tree changes. Re-run the local reproduction and the narrowest relevant project validation. If the failure cannot be reproduced locally, verify against the closest deterministic check and state the remaining gap.

Do not commit, push, rerun, cancel, or dispatch workflows unless the user explicitly asks. Report the root cause, changed files, validation results, and any remaining workflow action needed.
