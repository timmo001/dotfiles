---
name: staged-implementation
description: Execute broad changes one coherent, independently verifiable stage at a time. Use when work spans multiple independently reviewable changes, or when contracts, producer-consumer migrations, generated artefacts, or release packaging create an ordered multi-stage rollout; skip small single-purpose changes.
---

# Staged Implementation

Use this workflow when finishing the whole request in one uninterrupted change would create several independently reviewable changes. A stage is one coherent purpose with its tests and documentation, not an arbitrary file or line limit.

## Boundaries

- Keep exactly one active stage. Record dependent or unrelated work as deferred stages instead of editing towards all of them at once.
- Keep every checkpoint usable and independently verifiable. Do not leave an intermediate stage knowingly broken.
- A stage checkpoint pauses implementation; it does not mark a wider requested outcome complete while requested stages remain.
- Do not turn a small, single-purpose change into artificial phases.
- Reuse specialised skills for diagnosis, review, commits, handoffs, documentation, and framework work. This skill owns sequencing, not their domain rules.

## Plan The Work

1. Confirm repository conventions before proposing edits.
   - Read the applicable instructions and inspect the existing source and test layout.
   - Identify generated files and their source of truth.
   - For package or release work, choose the validation source up front: committed remote source, the current worktree, or a prepared source tree overlaid with local changes.
2. Split by coherent purpose and dependency order.
   - Separate prerequisites, contract changes, consumer migration, implementation replacement, generated output, and packaging when each can stand alone.
   - Keep tests and documentation with the behaviour they prove or explain.
   - When a public contract must change, define its final shape and rollout order before parallel work. Migrate tolerant consumers first only when old and new shapes genuinely need to coexist.
3. Define the active stage contract.
   - Goal and observable acceptance.
   - In-scope and deferred work.
   - One owner for shared interfaces, models, schemas, error shapes, migrations, and generated artefacts.
   - Anticipated files as a directory tree, split by repository or workspace root.
   - Targeted checks and the canonical final validation.
   - Commit-ready checkpoint conditions.
   - Whether execution stops at that checkpoint or continues through later named stages because the user requested one combined delivery.
4. List later stages briefly. Do not design their implementation in detail until they become active unless their interface constrains the active stage.

## Delegate Safely

- Parallelise independent discovery, tests, or disjoint implementation only. Keep ordered reasoning and shared mutable files with one integrator.
- Define shared contracts before delegation. Workers consume them; they do not independently redesign them.
- Give each worker a bounded brief: objective, authoritative inputs, exact file scope, prohibited shared files, expected output, verification, and required concise summary.
- Do not duplicate delegated work. Reconcile worker results through the contract owner before integration.

## Implement And Verify

1. Edit only the active stage and keep the diff focused on its stated purpose.
2. Use the fastest reliable feedback while iterating: the exact reproduction, affected test, touched-package type check, lint, format, or build command.
3. Once targeted checks pass and the diff stabilises, perform one focused review by risk area and file. Classify concrete findings as blocking or deferred follow-up; avoid repeated whole-diff review loops.
4. Fix blocking findings, then run the repository's canonical full validation once.
5. After full validation starts, freeze scope. Make only fixes for failures attributable to the active stage or unresolved blocking findings. Report pre-existing or unrelated failures separately. Record new hardening or cleanup ideas for a later stage.
6. If final-gate fixes were needed, confirm those fixes and their affected risk area rather than reopening the entire diff.
7. Do not repeat an unchanged fix-and-check cycle. If the same failure persists and another attempt has no new hypothesis or evidence, stop as blocked.

## Checkpoint

At the commit-ready boundary, report:

- Active stage and outcome: `complete` or `blocked`.
- Files changed and contracts established.
- Targeted and full validation evidence.
- Blocking review findings resolved and follow-ups deferred.
- The next independent stage, if any.

Stop at this checkpoint when remaining work is a separate reviewable change. Continue automatically only when it belongs to the same coherent review unit or the user explicitly requested the listed stages as one delivery. If requested stages remain, report the wider request as partial rather than complete. A request for one final commit does not by itself make several stages one implementation scope.
