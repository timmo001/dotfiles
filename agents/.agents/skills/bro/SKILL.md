---
name: bro
description: Re-pitch the immediately preceding response with enough context to follow, using plain, concise, unambiguous language. Use ONLY when the user explicitly invokes /bro or says the previous response did not land.
# origin: https://github.com/dmmulroy/skills/tree/main/bro
# upstream-sha: cbd1929589267453029859a43d2ecf411c865b54
# local-edits:
#   - replaced framework-specific invocation gating with an explicit-only description
#   - preserve concrete facts, paths, commands, citations, decisions, and next actions
#   - add context and ASD-STE100-inspired clarity without claiming strict compliance
---

# Bro

Restate your last response in plain human language. Add the minimum context needed for a reader who lost the thread. Use short, direct sentences and one meaning per sentence where practical. This is inspired by ASD-STE100 Simplified Technical English, not a claim of strict compliance with its controlled vocabulary and full rules.

Preserve concrete facts, decisions, file paths, commands, citations, and next actions. Remove jargon and process terminology. Do not add new analysis, repeat the original workflow, edit files, or call tools.
