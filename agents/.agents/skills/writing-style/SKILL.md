---
name: writing-style
description: Write commit messages, PR and issue text, docs, code comments, and user-facing copy in the project owner's voice: concise, human, UK English, no em-dashes, no robotic or marketing tone. Use when authoring or editing any commit message, pull request or issue description, README or docs, code comment, or user-facing string (notifications, UI labels, toasts, error messages). Defer to a repo's established house style when it has one; otherwise this sets the default voice.
---

# Writing Style

Write prose the agent authors on the user's behalf in the project owner's established voice: commit messages, pull request and issue text, READMEs and docs, code comments, and user-facing strings.

This is not LLM house style. Write like the person whose repo this is, judged against their existing work, not like a polished assistant.

## Permission: writing is not doing

Drafting the text is never permission to perform the action.

- Never create, amend, or push a commit unless the user explicitly asks.
- Never open, edit, comment on, or close a pull request or issue unless the user explicitly asks.
- Producing a commit message, PR description, or issue body on request does not authorise committing, pushing, or submitting it. Hand back the text and stop.
- Any action the user must explicitly request, never assume it. When unsure, ask first.

## Always (every artifact in scope)

These rules cover the artifacts this skill governs (commits, PR and issue text, docs, comments, user-facing strings). They are not the agent's whole obligation: chat replies and any other output are governed by AGENTS.md, which carries the same no-em-dash and no-robotic-tone rules and applies everywhere.

- Never use an em-dash (—) or a spaced en-dash (–) as a substitute. Use a hyphen, comma, colon, parentheses, or split the sentence.
- No robotic or marketing tone. Drop filler such as "seamlessly", "robust", "powerful", "effortless", "leverage", "delve", and throat-clearing such as "In order to", "It is worth noting", "Furthermore".
- Spelling: UK English by default (centralise, behaviour, colour, optimise, cancelled, licence as a noun); follow the repo's locale where it sets a different one. See "Defer to house style".
- Be concrete and specific over vague summary.
- Mirror the surrounding corpus before writing: skim recent commits, nearby docs, and existing UI strings, and match their tone, casing, and structure.

## Commit messages (default personal style)

- Imperative and verb-first: "Add", "Fix", "Remove", "Centralise", "Clarify", "Limit", "Drop".
- Sentence case, capitalised first word, no trailing full stop.
- Concise but informative: say what changed and, where it helps, the effect. Describe the change, do not restate the filename.
- Avoid bare single-word subjects ("Upd", "Note", "Fix" alone) when the change deserves a few words. Prefer "Notify on resume if clean" over "Note".
- No Conventional Commit prefixes (feat:, fix:) in personal repos. Follow the repo's convention where one exists.
- Always a single line. No body, no bullet lists, no multi-line messages. Multi-line bodies read as LLM-generated; keep the whole message to one concise subject line. Follow the repo's convention where one requires a body.

## PR and issue text

- Lead with what and why in a sentence or two. Skip template padding unless the repo requires it.

## Docs and READMEs

- Direct and friendly, first person where it fits. Emoji is fine where the existing doc already uses it; keep it out of commit messages and serious error copy.

## User-facing strings (notifications, UI, errors)

- Short, plain, and human. Say the thing. No robotic scaffolding, no em-dash.
- Match the app's existing string register; calibrate against nearby strings rather than inventing a new tone.

## Defer to house style

- When a repo has its own conventions (a CONTRIBUTING or docs style guide, or an established commit and docs style), follow it for structure, format, and spelling/locale, including a different default language. Keep only the universal rules: no em-dash, no robotic tone.

## Examples

- Robotic, with em-dash: "Enhance the notification system to seamlessly keep users informed — improving clarity." Prefer: "Notify on resume if clean".
- Vague single word: "Upd". Prefer: "Keep origin/HEAD fresh for default-branch detection".
- Marketing tagline: "A powerful, robust utility that effortlessly runs your tasks." Prefer: "A utility to run common tasks".
