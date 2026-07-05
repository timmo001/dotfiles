---
name: pr-review
description: Guidelines for reviewing pull requests - what to analyze, review etiquette, and output formatting
---

# PR Review Guidelines

Use this skill when reviewing code changes, pull requests, or diffs.

## Two Review Axes

Review changes along two separate axes so one doesn't mask the other:

### Standards — does the code follow the repo's style?

- In shared repos, use the user's own recently merged PRs as the style baseline rather than guessing from docs alone.
- Check repo-level guidance (AGENTS.md, CONTRIBUTING.md, ADRs, lint/formatter configs) but don't re-check what tooling already enforces.
- Cite the standard or precedent when flagging a violation.

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

# Watch for checks only when explicitly requested by the user
gh pr checks <PR_NUMBER> --watch

# View details of a specific workflow run (logs, status, jobs)
gh run view <RUN_ID>

# Checkout PR locally for deeper review
gh pr checkout <PR_NUMBER>
```

For upstream code patterns, API usage examples, or GitHub-hosted documentation, prefer `grep` over `webfetch` or `gh repo view` of raw file content. For broad read-only upstream dependency/source inspection, use an available read-only research subagent when delegation is useful. For library or framework documentation, prefer `context7` tools.

## Output Format

When providing review feedback:

1. Start with an **overview** of the PR (purpose, scope)
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
