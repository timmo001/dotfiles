---
name: grill-questions
description: Run an extended one-question-at-a-time planning interview to stress-test a proposed change before implementation. Use when the user says grill, grill me, stress-test this plan, ask more questions, or wants to expand the planning/question window instead of moving straight to a plan.
---

# Grill Questions

Use this skill for deliberate extended questioning before implementation. This is not routine clarification: the goal is to uncover hidden choices, sharpen scope, and decide whether the work is ready to plan or build.

## When to Use

- The user asks to be grilled, questioned, or stress-tested.
- A plan or proposed change needs deeper scrutiny before execution.
- The scope may be too broad and needs to be split into smaller grillable chunks.
- The user wants to extend the question window rather than receive a concise implementation plan.

## When NOT to Use

- A single missing detail blocks implementation; use `ask-questions-if-underspecified` instead.
- The user asks for a concise implementation plan; use `/plan` instead.
- The user asks for read-only codebase facts; use `/investigate` or `/explore-codebase` instead.
- The question needs a visual prototype, UI feel, or hands-on interaction to answer well; mark it as high-fidelity and recommend prototyping or concrete exploration.

## Rules

1. Ask exactly one question per turn until the session ends.
2. Include a recommended answer with every question, plus a brief reason for that recommendation.
3. Do not ask questions that quick read-only discovery can answer; inspect the repo, docs, or config instead.
4. Keep questions low-fidelity: scope, behaviour, constraints, tradeoffs, acceptance criteria, ordering, safety, and boundaries.
5. Call out high-fidelity questions explicitly instead of trying to settle them by chat.
6. Stay planning-only. Do not edit files, write specs, create issues, or implement code during grilling.

## Workflow

1. Identify the grilling target from the user's prompt, arguments, and current conversation context.
2. If the target is too broad, split it into 2-5 smaller grillable chunks and ask which chunk to grill first.
3. Run read-only discovery only when it can remove guesswork for the next question.
4. Ask the next highest-leverage question using this format:

```markdown
Question: {one question}

Recommended answer: {specific recommendation}

Why: {brief reason}
```

5. After the user's answer, update your internal understanding and ask the next highest-leverage question.
6. Stop when one of these is true:
   - the design is ready for `/plan` or implementation
   - the scope must be split further
   - a high-fidelity prototype or concrete exploration is needed
   - the user asks to stop, build, or summarise

## Final Summary

When stopping, summarise only the durable planning state:

- Decisions made
- Assumptions accepted
- Open questions
- Out of scope
- Readiness: `ready for /plan`, `ready to build`, `needs prototype`, or `needs more grilling`

Do not turn the summary into a PRD or issue unless the user explicitly asks.
