---
name: branch-context-consumer
description: Consume BranchContextPlugin injections in commands. Use when a command depends on an injected <branch-context> block for its scope.
---

# Branch Context Consumer

Standard contract for commands that depend on `BranchContextPlugin` injecting a `<branch-context>` block before execution.

## Parse and validate

1. Parse the injected `<branch-context>` block.
2. If `<branch-context>` is absent, do not run git fallback commands; stop and report that `BranchContextPlugin` did not inject context for this command.

## Modes

### Work-scope mode

Use when the command only needs the changed-file scope.

3. Read the `<work-scope>` section in this order: unstaged, staged, then branch diff.
4. Use the changed-file and diff-stat entries in `<work-scope>` to identify the scope before reading specific files.

### Full-context mode

Use when the command needs branch identity, status, PR state, or the full snapshot.

3. Read all tagged sections when present, in this order:
   - `<branch-metadata>`
   - `<status>`
   - `<work-scope>` (unstaged, staged, then branch diff)
   - `<pull-request>`
   - `<warnings>`
4. Prefer the precomputed entries from each section over reconstructing state with git or gh commands.

## Reporting

Include `scope source used (BranchContextPlugin context)` in the command's final report.
