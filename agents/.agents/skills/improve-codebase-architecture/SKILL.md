---
name: improve-codebase-architecture
description: Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick.
# origin: https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture
# upstream-sha: d574778f94cf620fcc8ce741584093bc650a61d3
# local-edits:
#   - SKILL.md: rewired /grilling to the local grill-questions skill at Full intensity; generalised CONTEXT.md/docs-adr references to the project's domain docs (repo uses no fixed CONTEXT.md/ADR layout)
#   - HTML-REPORT.md: generalised the ADR callout to a recorded-decision callout
disable-model-invocation: true
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

This command is _informed_ by the project's domain model and built on a shared design vocabulary:

- Run the `/codebase-design` skill for the architecture vocabulary (**module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**) and its principles (the deletion test, "the interface is the test surface", "one adapter = hypothetical seam, two = real"). Use these terms exactly in every suggestion — don't drift into "component," "service," "API," or "boundary."
- If the project keeps a domain glossary or domain docs, the language there gives names to good seams; any recorded design decisions cover ground this command should not re-litigate. This repo uses no fixed `CONTEXT.md`/`docs/adr/` layout, so treat these as "if present" rather than required.

## Process

### 1. Explore

If the project keeps a domain glossary, domain docs, or recorded design decisions, read the ones covering the area you're touching first.

Then use the Agent tool with `subagent_type=Explore` to walk the codebase. Don't follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

### 2. Present candidates as an HTML report

Write a self-contained HTML file to the OS temp directory so nothing lands in the repo. Resolve the temp dir from `$TMPDIR`, falling back to `/tmp` (or `%TEMP%` on Windows), and write to `<tmpdir>/architecture-review-<timestamp>.html` so each run gets a fresh file. Open it for the user — `xdg-open <path>` on Linux, `open <path>` on macOS, `start <path>` on Windows — and tell them the absolute path.

The report uses **Tailwind via CDN** for layout and styling, and **Mermaid via CDN** for diagrams where a graph/flow/sequence reliably communicates the structure. Mix Mermaid with hand-crafted CSS/SVG visuals — use Mermaid when relationships are graph-shaped (call graphs, dependencies, sequences), and hand-built divs/SVG when you want something more editorial (mass diagrams, cross-sections, collapse animations). Each candidate gets a **before/after visualisation**. Be visual.

For each candidate, render a card with:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality and leverage, and how tests would improve
- **Before / After diagram** — side-by-side, custom-drawn, illustrating the shallowness and the deepening
- **Recommendation strength** — one of `Strong`, `Worth exploring`, `Speculative`, rendered as a badge

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

**Use the project's own domain vocabulary for the domain (from its glossary or domain docs, if it keeps one), and the `/codebase-design` vocabulary for the architecture.** If the project's domain language names an "Order," talk about "the Order intake module" — not "the FooBarHandler," and not "the Order service."

**Recorded-decision conflicts**: if a candidate contradicts a design decision the project has already recorded, only surface it when the friction is real enough to warrant revisiting that decision. Mark it clearly in the card (e.g. a warning callout: _"contradicts a recorded decision — but worth reopening because…"_). Don't list every theoretical refactor a past decision forbids.

See [HTML-REPORT.md](HTML-REPORT.md) for the full HTML scaffold, diagram patterns, and styling guidance.

Do NOT propose interfaces yet. After the file is written, ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, run the `grill-questions` skill (`/grill`) at Full intensity to walk the design tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Side effects happen inline as decisions crystallize — run the `/domain-modeling` skill to keep the domain model current as you go:

- **Naming a deepened module after a concept the project's domain docs don't cover?** Record the term wherever the project keeps its domain vocabulary, if it keeps one. Don't stand up a glossary the project hasn't asked for.
- **Sharpening a fuzzy term during the conversation?** Capture it in the same place, right there.
- **User rejects the candidate with a load-bearing reason?** Offer to record the decision, framed as: _"Want me to note this so architecture reviews don't re-suggest it?"_ Only offer when the reason would help another reviewer avoid re-suggesting the same thing; skip ephemeral reasons ("not worth it") and self-evident ones.
- **Want to explore alternative interfaces for the deepened module?** Run the `/codebase-design` skill and use its design-it-twice parallel sub-agent pattern.
