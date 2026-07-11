---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when the user wants to pin down domain terminology or a ubiquitous language, challenge or record a design decision, or when another skill needs to maintain the domain model.
# origin: https://github.com/mattpocock/skills/tree/main/skills/engineering/domain-modeling
# upstream-sha: ee8bae40062cd6b435073368ed0c540f48c35862
# local-edits:
#   - SKILL.md: dropped the prescribed CONTEXT.md / docs/adr file-structure section and generalised term/decision capture to wherever the repo keeps them; this repo does not use a fixed CONTEXT.md/ADR layout
#   - ADR-FORMAT.md, CONTEXT-FORMAT.md: not imported (tied to the dropped convention)
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing decisions down the moment they crystallise. Merely *reading* existing docs for vocabulary is not this skill; that is a one-line habit any skill can do. This skill is for when you are changing the model, not just consuming it.

## Where the model lives

This repo does not prescribe a `CONTEXT.md` or `docs/adr/` layout. Record terms and decisions wherever the project already keeps them: an existing glossary or domain doc, a README section, the notes vault, or a short comment next to the code. If nothing exists yet, only create a home for it when there is something durable to write and the user wants it kept. Do not stand up a glossary or decision-record convention the project has not asked for.

Keep a glossary free of implementation detail: it is a shared language, not a spec or a scratch pad. Keep a decision record focused on the decision and its trade-off, not the mechanics.

## During the session

### Challenge against the shared language

When the user uses a term that conflicts with the language already in use, call it out immediately. "You've been using 'cancellation' to mean X, but here you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' - do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible - which is right?"

### Capture terms as they resolve

When a term is resolved, write it down right there, wherever the model lives. Don't batch these up; capture them as they happen.

### Record decisions sparingly

Only offer to write a decision record when all three are true:

1. **Hard to reverse** - the cost of changing your mind later is meaningful.
2. **Surprising without context** - a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** - there were genuine alternatives and you picked one for specific reasons.

If any of the three is missing, skip it. When you do record one, keep it to the decision, the alternatives considered, and why this one won.
