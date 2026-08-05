---
name: plan
description: Produce implementation-ready plans from the current conversation and repository context. Use when entering native plan mode, invoking /plan, or when a task needs concrete implementation sequencing before edits begin; do not use for round-based grilling.
---

# Plan

Produce a plain, implementation-ready plan that shows what code will change and how it will work. Keep small changes short. Prefer concrete pseudocode and real symbols over architecture language.

## Investigate

1. Use the existing conversation and already-gathered repository context as the primary source of truth.
2. Inspect the relevant implementation and tests before writing the plan. Trace callers, consumers, registrations, schemas, generated artefacts, and adjacent implementations only as far as the requested change needs.
3. Resolve facts available in the repository before asking the user. Do not submit a plan while paths, symbols, or behaviour remain generic placeholders.
4. Load `staged-implementation` only when repository inspection finds separate, independently reviewable changes. Otherwise write one dependency-ordered implementation sequence. Do not introduce stages, handoffs, checkpoints, or phase artefacts for a small change.
5. Load `writing-style` as the prose reference for the visible plan. Apply its plain, concise, concrete, human voice, UK English, and no-em-dash rules. Do not apply its commit-message, pull-request, issue, or action-authorisation instructions to plan structure.
6. Ask only the minimum necessary follow-up questions through the `question` tool when a requirement or trade-off cannot be inferred and would materially alter the implementation. Resolve those decisions before submitting the plan. Leave an open question in the submitted plan only when execution can safely proceed without resolving it. Do not run a grilling session while planning.

## Prepare Privately

Before writing the visible plan:

1. Reconcile the plan against every explicit user decision and any grill, research, issue, handoff, or specification decisions already in context. Treat later user feedback as authoritative. Preserve the difference between work deferred from the current turn and work excluded from the implementation.
2. Check scope completeness against every subsystem, workflow, tool, and outcome named by the user. Classify each as included, intentionally unchanged, or deferred with a reason. Do not silently narrow the request to the first implementation area found.
3. Distinguish observed repository facts, settled decisions, assumptions, and unresolved unknowns. Do not present an assumption as a fact or re-open a settled decision without contradictory evidence.
4. Resolve unknowns that affect the core implementation path before submission. Ask before choosing between materially different behaviours, data shapes, adopters, or migration paths. If repository inspection cannot resolve a technical unknown, make a bounded feasibility check the first plan step and state its success criterion, failure criterion, and fallback path. Do not defer core design choices with phrases such as "decide during implementation", "likely", or "possibly".
5. Verify proposed changes to shared interfaces, schemas, paths, persisted data, generated contracts, and public APIs against their producers and known consumers. Include compatibility work only when a concrete shipped, persisted, or external consumer requires it.
6. Keep rejected alternatives, recommendations, decision recaps, research summaries, architecture overviews, and assumptions lists out of the submitted plan. Put settled reasoning beside the implementation step it explains. If a blocking choice remains, ask the user before submitting the plan.

## Write The Plan

Use this order:

1. **What will happen:** Explain the resulting behaviour in one to three plain sentences. Name the first code entry point when useful. Do not include history, alternatives, architecture framing, validation, or repeated scope.
2. **Implementation:** Give numbered, dependency-ordered code changes. For each step:
   - Name the repository-relative file and existing function, class, type, route, schema, or other insertion point.
   - Explain the actual edit in ordinary language, including the important calls, branches, data shapes, state changes, or rendering conditions. Put the reason for a non-obvious choice immediately beside the edit it explains.
   - Show compact pseudocode immediately beneath that explanation for new or materially changed control flow, state transitions, data transformation, API handling, persistence, or rendering. Use symbols confirmed during repository inspection. When contrasting existing and proposed code, use a fenced `diff` block with `-` and `+` lines so Plannotator renders removals red and additions green. Use the relevant language fence for wholly new pseudocode. If those symbols are not known, inspect further before submitting. Omit pseudocode for skills, prose-only documentation, generated files, simple configuration changes, and trivial renames.
   - Mention required consumers, registrations, imports, translations, migrations, and generated outputs beside the code that creates the need.
   - Include a unit-test edit when an existing relevant test file already owns the changed behaviour, or when the user or repository explicitly requires it. Create a new test file only when a concrete regression risk affects a shared contract best proved through a consumer-facing boundary spanning multiple parts of the codebase. Do not plan a new isolated unit-test file around the changed implementation merely because code changed. Keep qualifying test edits and the behaviour they prove in the same step.
3. **Validation:** Give only the smallest targeted commands or end-to-end observations needed to prove the implementation works. Do not repeat test-file edits already described in the implementation.
4. **Files:** Include every anticipated changed, added, deleted, generated, or migration file as a directory tree, split by repository or workspace root. Mark generated files with their source of truth. Every file in the tree must appear in an implementation step.

Pseudocode earns its place when it exposes changed code flow more clearly than prose. It must trace inspected project symbols rather than inventing a generic example or placeholder API.

## Keep It Direct

- Prefer a small direct implementation over speculative abstractions, compatibility layers, helpers, migrations, or phases.
- Follow the loaded `writing-style` skill for the plan's prose. Write in the maintainer's direct, practical voice. Avoid generic AI prose: no formal padding, flattering agreement, marketing language, repeated summaries, or long transitions that delay the implementation. Use short sentences and say exactly what the code will do and why.
- Do not use jargon when ordinary language or a code symbol is clearer. Explain an unavoidable technical term once in plain English.
- Do not use verbs such as "update", "wire", "handle", "support", "integrate", or "refactor" instead of saying what the code will do.
- Discuss architecture only where it causes a specific code change. Follow architecture statements immediately with the files, symbols, and pseudocode that implement them.
- Do not add top-level **Architecture**, **Decisions**, **Assumptions**, **Research**, or **Risks** sections unless the user explicitly requested that separate analysis. Put any implementation-relevant content from them in the numbered step where it changes the edit.
- Spend most of the plan on implementation. Do not let validation, testing, risks, or coordination artefacts outweigh the code changes.
- Keep detail proportional: one compact step for a small change, several steps for a standard change, and stages only for independently reviewable work.
- For staged work, follow `staged-implementation` for checkpoints and handoffs, but keep those coordination details after the active implementation rather than ahead of it.

## Review And Revise

Before submission, verify that:

- Every acceptance criterion maps to an implementation step and a targeted or final check.
- Every entry in `Files` appears in a step, and every generated file names its source of truth.
- No requested area disappeared from scope and no settled decision is contradicted.
- No core mechanic remains an unbounded assumption or execution-time decision.
- Every numbered step describes an edit rather than analysis, and every non-obvious reason follows the edit it justifies.
- Pseudocode uses symbols confirmed during repository inspection, and no unresolved choice has been made for the user.
- Before-and-after code examples use fenced `diff` blocks; wholly new pseudocode uses its language fence.
- Safeguards, compatibility layers, abstractions, migrations, and new tests address an observed contract or regression risk rather than speculative hardening. Test edits also satisfy the existing-test, explicit-guidance, or shared-boundary rule above.
- The visible plan begins with the plain explainer, contains pseudocode where logic changes, and gives implementation more space than validation.

When the user changes a decision after a plan is drafted, perform a contradiction and impact scan. Revise only the affected scope, steps, files, acceptance criteria, risks, and validation unless the change invalidates the plan's foundation.

## Finish Planning

Keep the output planning-focused and make no implementation edits while planning. End by stating that execution can continue after approval, then leave plan mode.
