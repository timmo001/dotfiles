---
name: ask-questions-if-underspecified
description: Ask minimal clarifying questions only when ambiguity materially changes implementation. Use for routine underspecification; do not use for extended grilling, plan stress-testing, or broad design interviews.
# origin: https://github.com/trailofbits/skills/tree/main/plugins/ask-questions-if-underspecified/skills/ask-questions-if-underspecified
# upstream-sha: d5fe2e6a7896236c3102fd5477e833623ad70298
# local-edits:
#   - description rewritten for brevity and narrowed away from grill-style questioning
#   - body condensed from detailed template-based process to concise OpenCode workflow
#   - added OpenCode-specific rules (question tool, recommended tags)
#   - removed verbose question templates and reply format examples
---

# Ask Questions If Underspecified (OpenCode)

Use this skill when a request has multiple plausible implementations and picking the wrong one would cause rework, risk, or incorrect outcomes. This skill is intentionally narrow: it should unblock work with the fewest questions possible.

## When to Use

- Key details are unclear: objective, done criteria, scope, constraints, environment, or safety
- Multiple reasonable interpretations would lead to materially different work
- You cannot resolve ambiguity with quick, read-only discovery

## When NOT to Use

- The request is clear enough to proceed safely
- A quick repo read (files/config/docs) can answer the unknowns
- Repo conventions provide a safe default and ambiguity is low impact
- The user wants to be grilled, stress-test a plan, or extend the question window; use `grill-questions` or `/grill` instead

## OpenCode-Specific Rules

1. Ask the minimum needed to unblock work (prefer one targeted question).
2. Use the `question` tool for user questions.
3. Put recommended/default choices first and tag them with `(Recommended)`.
4. Do all non-blocked, low-risk discovery first.
5. Until must-have answers arrive, do not edit files or run state-changing commands.
6. If the user asks to proceed without answers, state assumptions briefly and continue with safest defaults.
7. Never turn this into a multi-turn design interview unless the user explicitly invokes `/grill` or asks to be grilled.

## Workflow

1. Run quick discovery (read-only) to remove guesswork.
2. Identify only must-have unknowns that change implementation direction.
3. Ask 1-3 concise questions max in the first pass.
4. Prefer multiple-choice options over open-ended prompts.
5. Include a low-friction fallback, e.g. `Use recommended defaults`.
6. After answers, restate requirements in 1-3 sentences and proceed.

## Must-Have Clarification Areas

- Objective: what should change and what should stay the same
- Definition of done: acceptance criteria, examples, edge cases
- Scope: what is in/out
- Constraints: compatibility, performance, style, dependency limits
- Environment: runtime/tooling versions when relevant
- Safety: migration, rollback, irreversible actions

## Anti-Patterns

- Asking questions answerable via quick discovery
- Asking broad/open questions when options would be clearer
- Running an extended grilling session under this skill instead of `/grill`
- Asking permission for routine safe steps
- Blocking on nice-to-know details that can use project defaults
- Asking users to reply with numbered text when the `question` tool can capture choices
