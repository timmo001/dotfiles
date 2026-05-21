---
name: improve-codebase-architecture
description: Review a codebase area for architectural friction and propose focused structural improvements. Use when the user wants to improve maintainability, reduce coupling, simplify understanding, or identify where code should be consolidated or deepened.
# origin: https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture
# upstream-sha: a36584e09eaee067c425938fd66bc7ccddf089e2
# local-edits:
#   - SKILL.md: condensed body, rewritten description, OpenCode tool references, plan-mode gated side effects
#   - INTERFACE-DESIGN.md: Claude sub-agent spawning replaced with direct process
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. Use this skill when the job is to review structure, not just clean up syntax or fix one bug.

## When to Use

- Architecture or maintainability review of a feature or subsystem
- Areas that feel over-abstracted, scattered, tightly coupled, or hard to test
- Follow-up after a bug or refactor when the deeper structural issue is still unclear

## When NOT to Use

- Small behaviour-preserving cleanup work
- Straightforward bug fixes with a clear local cause
- Broad codebase exploration with no structural question to answer

## Glossary

Use these terms exactly in every suggestion. Consistent language is the point — don't drift into "component," "service," "API," or "boundary." Full definitions in [LANGUAGE.md](references/LANGUAGE.md).

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place. (Use this, not "boundary.")
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

Key principles (see [LANGUAGE.md](references/LANGUAGE.md) for the full list):

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

## Process

### 1. Explore

Read any project glossary (CONTEXT.md) and ADRs in the area you're touching first — if they exist. Do not assume they do.

Then use the `task` tool with `subagent_type: "explore"` to walk the codebase. Don't follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

### 2. Present candidates as an HTML report

Write a self-contained HTML file to the OS temp directory so nothing lands in the repo. Resolve the temp dir from `$TMPDIR`, falling back to `/tmp`, and write to `<tmpdir>/architecture-review-<timestamp>.html`. Open it for the user (`xdg-open <path>` on Linux, `open <path>` on macOS) and tell them the absolute path.

The report uses **Tailwind via CDN** for layout and styling, and **Mermaid via CDN** for diagrams where a graph/flow/sequence reliably communicates the structure. Mix Mermaid with hand-crafted CSS/SVG visuals. Each candidate gets a **before/after visualisation**.

For each candidate, render a card containing:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality and leverage, and how tests would improve
- **Before / After diagram** — side-by-side, illustrating the shallowness and the deepening
- **Recommendation strength** — one of `Strong`, `Worth exploring`, `Speculative`, rendered as a badge

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

If glossary or domain docs exist, use their vocabulary for domain concepts alongside [LANGUAGE.md](references/LANGUAGE.md) vocabulary for architecture.

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly in the card with a warning callout.

See [HTML-REPORT.md](references/HTML-REPORT.md) for the full HTML scaffold, diagram patterns, and styling guidance.

Do NOT propose interfaces yet. After the report is written, ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, drop into a grilling conversation. Walk the design tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

As decisions crystallize, **propose** side effects but do not apply them without explicit user confirmation:

- **Naming a deepened module after a concept not in the project glossary?** Propose adding the term to CONTEXT.md (or creating it).
- **User rejects the candidate with a load-bearing reason?** Offer an ADR, framed as: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Only offer when the reason would actually be needed by a future explorer.
- **Want to explore alternative interfaces for the deepened module?** See [INTERFACE-DESIGN.md](references/INTERFACE-DESIGN.md).

All file writes require user confirmation before applying.

## Guardrails

- Prefer focused architectural improvements over speculative redesign.
- Do not assume glossary docs or ADRs exist.
- Do not force interface design in the first pass; identify the pressure points first.
- When the user picks a candidate to explore, use the [DEEPENING.md](references/DEEPENING.md) dependency categories to classify what the module depends on and determine testing strategy.
- When alternative interfaces are worth exploring, follow the [INTERFACE-DESIGN.md](references/INTERFACE-DESIGN.md) process (Design It Twice).
- Keep recommendations concrete enough to act on, but scoped enough to debate.
