---
name: grill-questions
description: Stress-test a plan or proposed change through focused one-question-at-a-time grilling, with light and full intensity. Use when the user says grill, grill me, grill me lightly, ask me a couple of questions, stress-test this plan, or wants question-led scrutiny before planning.
# origin: https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling
# upstream-sha: e5932a7a47e5cae312c1b814ce6194b09aa27be1
# local-edits:
#   - renamed and adapted for the OpenCode question tool and read-only planning workflow
#   - added light/full intensity, materiality and assumption gates, proactive stopping, and a decision summary
---

# Grill Questions

Use this skill for deliberate question-led stress-testing before implementation. This is not routine clarification: preserve depth by concentrating on decisions that can change the direction, not by enumerating every possible question.

## When to Use

- The user asks to be grilled, questioned, or stress-tested.
- A plan or proposed change needs deeper scrutiny before execution.
- The scope may be too broad and needs to be split into smaller grillable chunks.
- The user wants a light or full question pass before receiving an implementation plan.

## When NOT to Use

- A single missing detail blocks implementation; use `ask-questions-if-underspecified` instead.
- The user asks for a concise implementation plan; use `/plan` instead.
- The user asks for read-only codebase facts; use `/investigate` or `/explore-codebase` instead.
- The question needs a visual prototype, UI feel, or hands-on interaction to answer well; mark it as high-fidelity and recommend prototyping or concrete exploration.

## Rules

1. Ask exactly one question per turn, as a single `question` tool call.
2. Make the recommended answer the first option in the `question` tool call, append `(Recommended)` to its label, and put the brief reason in that option's description.
3. Treat explicit user direction and prior answers as settled. Do not ask the user to repeat or confirm them.
4. Look up facts that quick read-only discovery can answer. Infer reversible, low-impact defaults from explicit direction, prior conversation, repo conventions, or normal local conventions and record them as working assumptions.
5. Decisions remain with the user. Never silently assume an unresolved choice that could materially change scope, externally visible behaviour, acceptance criteria, safety, data, migration or compatibility requirements, cost, or an irreversible action.
6. Ask a question only when plausible answers would materially change the plan or implementation. Skip nice-to-know, speculative, checklist-driven, and low-level questions with a safe default.
7. Walk the decision tree in dependency order: settle root choices before details that depend on them. Among currently unblocked choices, ask the highest-leverage one.
8. Keep questions low-fidelity: scope, behaviour, constraints, tradeoffs, acceptance criteria, ordering, safety, and boundaries.
9. Call out high-fidelity questions explicitly instead of trying to settle them by chat.
10. Stay planning-only. Do not edit files, write specs, create issues, or implement code during grilling.

## Intensity

Infer intensity from the user's wording and current conversation. Do not ask about intensity when it is already implied.

- **Light**: phrases such as "lightly grill me", "a quick pass", "ask me a couple", "ask me a few", or "only ask the important questions". Ask at most three substantive questions, or honour a lower explicit limit. Often one or two are enough. The intensity question does not count towards this limit. Then summarise rather than starting another round unless the user asks for more.
- **Full**: phrases such as "grill me thoroughly", "go deep", "full grill", or an explicit request to examine every material branch. There is no fixed question cap, but every next question must still pass the materiality gate.
- **Unspecified**: when neither wording nor conversation context implies an intensity, ask once whether to use Light or Full. Recommend Light unless the known risk or complexity clearly warrants Full.

The user may change intensity at any point. Intensity controls depth, not whether material decisions can be assumed.

## Workflow

1. Identify the grilling target from the user's prompt, arguments, and current conversation context.
2. Infer Light or Full from the user's wording and context. Ask the intensity question only when it remains unspecified.
3. If the target is too broad, split it into 2-5 smaller grillable chunks and ask which chunk to grill first with the `question` tool (one option per chunk).
4. Run a short read-only context pass to settle facts and collect safe working assumptions.
5. Separate settled direction, discovered facts, reversible defaults, and unresolved material decisions.
6. Ask the earliest dependency and highest-leverage unresolved material decision with the `question` tool:
   - State any working assumptions briefly in your reply text before the call, only when useful.
   - Send exactly one question, with a short `header` (max 30 characters).
   - Make the recommended answer the first option and append `(Recommended)` to its label; put the brief reason in that option's description.
   - Add the other plausible answers as concrete options so the user can pick fast. Do not add an "Other" or catch-all option; the tool adds "Type your own answer" automatically.

7. After each answer, update the decision tree and re-run the materiality gate. Do not continue merely because another possible question exists.
8. Stop and summarise when one of these is true:
   - no unresolved question passes the materiality gate
   - Light reaches its question limit
   - the scope must be split further
   - a high-fidelity prototype or concrete exploration is needed
   - the user asks to stop, build, or summarise

## Final Summary

When stopping, summarise only the durable planning state:

- Intensity used
- Decisions made
- Working assumptions
- Open material decisions
- Out of scope
- Readiness: `ready for handoff`, `needs prototype`, `needs targeted investigation`, or `needs more grilling`

Do not treat your own summary as permission to implement. The user confirms the handoff by asking to plan, build, leave grilling, or explicitly accepting the summary; do not add a redundant confirmation question. Do not turn the summary into a PRD or issue unless the user explicitly asks.
