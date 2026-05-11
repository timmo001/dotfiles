---
name: diagnose
description: Disciplined diagnosis workflow for hard bugs, regressions, flaky behavior, and performance issues. Use when behavior is broken, failing, intermittent, or slower than expected and the agent needs a reproducible feedback loop before fixing.
# origin: https://github.com/mattpocock/skills/tree/main/skills/engineering/diagnose
# upstream-sha: 7afa86d3a5dd96edde06ffa014e16c64e733681e
# local-edits:
#   - description rewritten for OpenCode context
#   - body condensed from six prescriptive phases to a concise workflow with checklist
#   - removed Claude-specific language and LANGUAGE.md/CONTEXT.md references
#   - added tool guidance section for OpenCode agents
---

# Diagnose

Use this skill for debugging work where ad-hoc inspection is likely to miss the cause.

## When to Use

- Bug reports and behavioural regressions
- Failing or flaky tests
- Intermittent errors or wrong output
- Performance regressions that need measurement before a fix

## When NOT to Use

- Broad codebase exploration with no concrete failure mode
- Pure refactors or cleanup work
- Type, lint, or formatting errors that already have a direct fix path

## Workflow

1. Build a feedback loop first.
   - Prefer a fast, deterministic pass/fail signal before changing code.
   - Good loops include: a CLI invocation, a minimal repro script, a dev-server request, a browser-driven repro, or a failing test when a well-used helper or existing test seam already makes that the smallest correct option.
2. Reproduce the reported problem.
   - Confirm the loop matches the user's actual failure, not a nearby symptom.
   - If the issue is flaky, work on increasing reproduction rate before hypothesising.
3. Rank hypotheses.
   - Generate 3-5 falsifiable hypotheses when the cause is not obvious.
   - Share the ranked list when user or domain context is likely to change the order materially.
4. Instrument narrowly.
   - Prefer debuggers, targeted logs, or focused measurements over broad logging.
   - Tag temporary debug logs with a unique prefix so they are easy to remove.
5. Fix with lightweight verification.
   - Prefer the smallest verification that proves the real failure path is fixed.
   - Add or adapt a regression test only when it is clearly worthwhile, reproducible, or already fits an existing well-used helper or test seam.
   - If no good test seam exists, do not force one just for process.
6. Re-run the original loop and clean up.
   - Confirm the original repro no longer fails.
   - Remove temporary instrumentation and throwaway harnesses unless they remain intentionally useful.

## Tool Guidance

- Start with narrow local reads and searches before broad exploration.
- Use the `task` tool with `subagent_type: "explore"` for wide codebase discovery.
- Use Chrome DevTools tools for browser-specific bugs.
- Use tests, CLI commands, curl, small repro scripts, or harnesses to create deterministic loops.
- If project glossary, ADRs, or local architecture docs exist, use them to avoid misreading terms or constraints.
- Ask one targeted question only when a missing detail blocks diagnosis.

## Done Checklist

- The original failure is reproduced or the missing repro constraint is stated clearly.
- The fix is validated against the original loop.
- Any added regression coverage is justified by an existing seam or clear reuse value.
- Temporary debug instrumentation is removed.
- Any remaining uncertainty or follow-up risk is called out explicitly.
