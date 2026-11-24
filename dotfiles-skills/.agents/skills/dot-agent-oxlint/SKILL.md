---
name: dot-agent-oxlint
license: Apache-2.0
compatibility: Requires the dot agent oxlint command and its managed package cache. Running the advisory pass normally requires repository opt-in through private configuration.
description: Run the advisory Oxlint pass on JavaScript or TypeScript changes in dot-managed repositories. Use after the repository's own lint workflow whenever a task changes JS or TS files; the command checks private opt-in and local Oxlint precedence and reports only findings on changed lines.
---

# Agent Oxlint

1. Read the repository instructions and run its own lint workflow first.
2. Run it once the change is ready, not after every edit:

   ```bash
   dot agent oxlint --changed
   ```

   It lints uncommitted and untracked changes against `HEAD` and prints only
   findings on added or modified lines. Pass explicit paths to lint whole
   files, or `--all` for a full-tree scan, only when the user requests or the
   task requires it.
   When the user explicitly asks to persist the opt-in, run
   `dot agent oxlint --opt-in`; it commits the single-line private config change
   without pushing. If the repository has no private entry, induct it with
   `--agent-oxlint` as `dot-repositories` describes, then resume the lint.
3. Treat either successful skip as final unless the user explicitly asked to
   force the pass:
   - the repository is not opted in through private `dot-git.yml`;
   - the repository has its own Oxlint config, dependency, script, or binary.

   Do not bypass either gate or add files to make this pass run.
4. Fix the reported findings that belong to your change. Do not clean
   pre-existing findings elsewhere, and do not widen the diff to make the pass
   clean. If a fix would change behaviour or the design, report the finding
   instead of forcing it.
5. Report personal-pass findings separately from the repository's own lint
   result. The managed pass uses only the generic recommended rules.

`dot git commit` runs the same changed-lines check on the files it commits;
`dot-git-commit` owns what to do when it refuses a commit.

For a repository that should own these rules, load
`install-timmo-oxlint-rules` instead. Do not use this wrapper as a substitute
for adopting the package in a personal repository.
