---
name: diagnose
description: Disciplined diagnosis workflow for hard bugs, regressions, flaky behavior, and performance issues. Use when behavior is broken, failing, intermittent, or slower than expected and the agent needs a reproducible feedback loop before fixing.
# origin: https://github.com/mattpocock/skills/tree/main/skills/engineering/diagnosing-bugs
# upstream-sha: 221ffca96736afefdc08ca7cf0b3965e9ea83f41
# local-edits:
#   - SKILL.md: local name retained after upstream rename, condensed body, rewritten description, OpenCode tool guidance, no test-first workflow
#   - hitl-loop.template.sh: verbatim from upstream
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
   - **This is the skill.** Everything else is mechanical. Spend disproportionate effort here.
   - Prefer a fast, deterministic pass/fail signal before changing code.
   - Techniques to construct one (roughly in order of preference):
     1. Failing test at whatever seam reaches the bug.
     2. Curl / HTTP script against a running dev server.
     3. CLI invocation with a fixture input, diffing stdout against known-good output.
     4. Headless browser script (Playwright / Puppeteer) -- drives UI, asserts on DOM/console/network.
     5. Replay a captured trace -- save a real network request / payload / event log to disk; replay it through the code path in isolation.
     6. Throwaway harness -- spin up a minimal subset of the system (one service, mocked deps) that exercises the bug path with a single function call.
     7. Property / fuzz loop -- if the bug is "sometimes wrong output", run 1000 random inputs and look for the failure mode.
     8. Bisection harness -- if the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so you can `git bisect run` it.
     9. Differential loop -- run the same input through old-version vs new-version (or two configs) and diff outputs.
     10. HITL bash script -- last resort. If a human must click, drive them with [hitl-loop.template.sh](scripts/hitl-loop.template.sh) so the loop is still structured.
   - Iterate on the loop itself: make it faster, make the signal sharper, make it more deterministic. A 2-second deterministic loop is a debugging superpower.
   - For non-deterministic bugs: loop the trigger 100x, parallelise, add stress, narrow timing windows, inject sleeps. Raise reproduction rate until debuggable.
   - If you genuinely cannot build a loop, stop and say so. List what you tried. Ask the user for environment access, a captured artifact, or permission to add temporary instrumentation.
   - Before moving on, name one command or script you have already run at least once. It should drive the real bug path, be able to catch the user's exact symptom, be deterministic enough to trust, run in seconds where possible, and be agent-runnable unless the HITL template is required.
   - If you catch yourself reading code to build a theory before this command exists, stop and tighten the loop first.
2. Reproduce and minimise the reported problem.
    - Confirm the loop matches the user's actual failure, not a nearby symptom.
    - If the issue is flaky, work on increasing reproduction rate before hypothesising.
    - Shrink the repro one input, caller, config value, data item, or step at a time. Keep only elements that are load-bearing for the failure.
3. Rank hypotheses.
    - Generate 3-5 falsifiable hypotheses when the cause is not obvious.
    - Use this shape: "If <X> is the cause, then <changing Y> will make the bug disappear or <changing Z> will make it worse."
    - Share the ranked list when user or domain context is likely to change the order materially.
4. Instrument narrowly.
    - Prefer debuggers, targeted logs, or focused measurements over broad logging.
    - Map each probe to one hypothesis prediction and change one variable at a time.
    - For performance regressions, establish a baseline measurement first. Prefer profilers, timing harnesses, query plans, and bisection over logs.
    - Tag temporary debug logs with a unique prefix so they are easy to remove.
5. Fix with lightweight verification.
    - Prefer the smallest verification that proves the real failure path is fixed.
    - Add or adapt a regression test only when it is clearly worthwhile, reproducible, or already fits an existing well-used helper or test seam.
    - If no good test seam exists, do not force one just for process. Call out the missing seam as an architecture follow-up when it matters.
6. Re-run the original loop and clean up.
    - Confirm the original repro no longer fails.
    - Remove temporary instrumentation and throwaway harnesses unless they remain intentionally useful.
    - State the hypothesis that turned out to be correct in the final explanation, commit message, or PR text where relevant.

## Tool Guidance

- Start with narrow local reads and searches before broad exploration.
- Use the `task` tool with an available local exploration subagent for wide codebase discovery.
- Use Chrome DevTools tools only for browser-specific bugs.
- Use tests, CLI commands, curl, small repro scripts, or harnesses to create deterministic loops.
- Do not trim normal command output with `head` or `tail`. If a repro command is genuinely huge, capture output to a file and inspect targeted sections with `Grep` or `Read` offsets instead of re-running.
- If project glossary, ADRs, or local architecture docs exist, use them to avoid misreading terms or constraints.
- Ask one targeted question only when a missing detail blocks diagnosis.

## Done Checklist

- The original failure is reproduced or the missing repro constraint is stated clearly.
- The fix is validated against the original loop.
- Any added regression coverage is justified by an existing seam or clear reuse value.
- Temporary debug instrumentation is removed.
- Any remaining uncertainty or follow-up risk is called out explicitly.
