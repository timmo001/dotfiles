---
description: Manual entrypoint to native plan mode from the current conversation context
agent: plan
---

Use this command when the current task would benefit from an explicit plan before implementation and the user wants to start in planning mode explicitly.

Use `/grill` instead when the user wants light or full one-question-at-a-time stress-testing before a plan.

Some execution-oriented agents may also enter native plan mode automatically via `plan_enter`; this command is the manual entrypoint.

Use the existing conversation and already-gathered repo context as the primary source of truth. If `${ARGUMENTS}` is present, treat it as the planning target or refinement.

Load the `staged-implementation` skill and use it to decide whether the target is one coherent stage or several independently reviewable stages. Do not invent phases for a small change.

Before writing the plan, inspect the relevant implementation and tests. Trace callers, consumers, registrations, schemas, generated artefacts, and adjacent implementations only as far as the requested change needs. Resolve facts available in the repository before asking the user. Do not submit a plan while paths, symbols, or behaviour remain generic placeholders.

Produce an implementation-ready plan that another engineer can execute without repeating the repository investigation. Keep a small change concise, but do not trade away technical detail or code locations.

For each implementation step, include the applicable details below. Combine related details when that reads more clearly, and omit fields that genuinely do not apply rather than adding boilerplate:

- **Location:** Give the repository-relative file path and the class, function, type, schema, route, style block, translation subtree, or other insertion point. Add `path:line` only when the inspected line is stable and useful.
- **Current behaviour:** Explain what the named code does now and why it owns the change. This may be omitted for a genuinely new, isolated file.
- **Change mechanics:** Describe the concrete type or interface changes, control or data flow, state transitions, rendering conditions, events, API or service payloads, defaults, error behaviour, persistence, and generated output relevant to the step.
- **Reuse:** Name existing symbols or patterns to call, extend, mirror, move, or extract, with their locations. Identify shared helpers or a contract owner when the change would otherwise duplicate behaviour.
- **Integration:** Include the required union entries, factories, registries, imports, consumers, editor fields, translations, documentation, migrations, and generated artefacts beside the step that introduces the behaviour.
- **Verification:** Name the exact test file and cases to add or update, the targeted command, and the observable manual result when automated coverage is unsuitable.

Do not use verbs such as "update", "wire", "handle", "support", "integrate", or "refactor" as substitutes for explaining where and how the implementation changes. Replace project-specific jargon with concrete symbol names, or explain it on first use.

The plan must also include:

- Goal and scope.
- One active stage with observable acceptance stated as user-visible behaviour, an API contract, generated output, or tests. Identify the owner of each shared interface, schema, model, migration, or generated artefact, order steps by dependency, and list the canonical final validation order.
- Targeted checks beside the steps they verify, followed by the canonical final validation for the active stage.
- A `Files` section containing every anticipated changed, added, deleted, generated, or migration file as a directory tree, split by repository or workspace root. Label generated files with their source of truth. Each file must also appear in the implementation step that explains its change; the tree is an index, not a substitute for locations and mechanics.
- Deferred stages only when they are separate reviewable changes, including whether execution stops at their checkpoints or continues because the user requested one combined delivery.
- Phase artefacts: recommend a separate numbered handoff for each deferred reviewable phase using `handoff-{feature}-{phase-number}-{phase-slug}.md`. In a new repository, try handoffs first; if repository notes cannot be resolved yet, propose one repository-local all-in-one working Markdown plan using the repository convention or `PLAN.md`, include it in `Files`, and define numbered phases with explicit statuses that the same document updates at every checkpoint. Migrate its remaining phases to numbered handoffs once available.
- Artefact cleanup: make deletion of each handoff or temporary plan the final step of the work it tracks. For a note, require explicit user confirmation immediately before `notes_note_delete`. For a repository-local working plan, include its deletion in `Files`. Never retire an artefact that still records deferred, blocked, or unresolved work.
- Only risks and assumptions that affect implementation or validation. Name the affected code path and mitigation rather than using broad risk labels.

Ask only the minimum necessary follow-up questions through the `question` tool when a requirement or trade-off cannot be inferred and would materially alter the implementation. Resolve those decisions before submitting the plan. Leave an open question in the submitted plan only when execution can safely proceed without resolving it. Do not run a grilling session from `/plan`.

Keep the output planning-focused and make no edits from this command. End by stating that execution can continue after approval and leaving plan mode.
