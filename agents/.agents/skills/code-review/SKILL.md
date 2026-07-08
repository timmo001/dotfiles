---
name: code-review
description: Review code changes along two axes - Standards (does it follow the repo's conventions, plus a Fowler code-smell baseline?) and Spec (does it implement what the originating issue or spec asked for?). Use when reviewing a pull request, a branch, work-in-progress changes, or a diff.
---

# Code Review

Use this skill when reviewing code changes, pull requests, branch work, or diffs.

Lineage: locally authored. The Standards-axis Fowler smell baseline is adapted from mattpocock's `code-review` skill (<https://github.com/mattpocock/skills/tree/main/skills/engineering/code-review>), itself drawn from Martin Fowler, _Refactoring_, ch.3 "Bad Smells in Code".

## Two Review Axes

Review changes along two separate axes so one doesn't mask the other:

### Standards — does the code follow the repo's style?

- In shared repos, use the user's own recently merged PRs as the style baseline rather than guessing from docs alone.
- Check repo-level guidance (AGENTS.md, CONTRIBUTING.md, ADRs, lint/formatter configs) but don't re-check what tooling already enforces.
- Cite the standard or precedent when flagging a violation.

On top of whatever the repo documents, the Standards axis always carries the **Fowler smell baseline** below - a fixed set of code smells that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation - and, like any standard here, skip anything tooling already enforces.

Each smell reads _what it is_ → _how to fix_; match it against the diff:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### Spec — does the code do what was asked?

- Find the originating issue, PRD, or spec from commit messages, PR description, or branch name.
- Report: requirements that are missing/partial, behaviour that wasn't asked for (scope creep), requirements where the implementation looks wrong.
- If no spec exists, skip this axis and note it.

## What to Analyze

When reviewing code changes, evaluate:

1. **Code quality and style consistency** - Does it follow existing patterns?
2. **Potential bugs or issues** - Edge cases, error handling, null checks
3. **Performance implications** - N+1 queries, unnecessary iterations, memory leaks
4. **Type safety** - Missing types, any casts, unsafe assertions
5. **Breaking changes** - API changes, schema changes (flag these explicitly)
6. **Security concerns** - Input validation, authentication, secrets exposure
7. **Test coverage** - Are new code paths tested? Are edge cases covered?
8. **Documentation** - Are changes documented if needed?

## Review Etiquette

- Be constructive and specific in comments
- Suggest improvements rather than just pointing out problems
- Acknowledge good practices when you see them
- Explain the "why" behind suggestions
- Differentiate between blocking issues and nice-to-haves

## Using GitHub CLI

Use `gh` CLI for PR workflow operations:

```bash
# Get PR details and description
gh pr view <PR_NUMBER>

# See all changes in the PR
gh pr diff <PR_NUMBER>

# Check CI status (includes linter warnings)
gh pr checks <PR_NUMBER>

# Watch checks when the task requires waiting for CI
gh pr checks <PR_NUMBER> --watch

# View details of a specific workflow run (logs, status, jobs)
gh run view <RUN_ID>

# Watch a specific workflow run compactly after checking local CLI support
gh run watch <RUN_ID> --compact --exit-status --interval 10

# Checkout PR locally for deeper review
gh pr checkout <PR_NUMBER>
```

For long-running GitHub Actions waits, prefer compact `gh` watches over repeated GitHub MCP polling when the installed CLI supports them. Check `gh run watch --help` or `gh pr checks --help` first, and do not use `gh run view --watch` unless this local CLI documents it.

For upstream code patterns, API usage examples, or GitHub-hosted documentation, prefer `grep` over `webfetch` or `gh repo view` of raw file content. For broad read-only upstream dependency/source inspection, use an available read-only research subagent when delegation is useful. For library or framework documentation, prefer `context7` tools.

## Output Format

When providing review feedback:

1. Start with an **overview** of the change (purpose, scope)
2. Report **Standards** and **Spec** findings separately
3. List **specific comments** for each file/line needing attention
4. Differentiate between blocking issues and nice-to-haves
5. Summarize with an **overall assessment**:
   - Approve
   - Request changes
   - Comment (needs discussion)

## Important

- Do NOT post comments to GitHub directly unless explicitly asked
- Do NOT make code changes during review
- If checking out locally, ensure the checkout is up to date with remote
