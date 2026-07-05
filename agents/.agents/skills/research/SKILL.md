---
name: research
description: Investigate a topic against primary sources and return cited findings. Use when the user wants a topic researched, docs, API, or spec facts gathered, an external library or GitHub behaviour verified, or reading legwork delegated to a background agent.
---

# Research

Answer a question by reading the sources that own the answer, then hand back findings with every claim tied to its source. This is external primary-source research, distinct from `/investigate` (local triage and diagnosis) and `/explore-codebase` (internal codebase discovery).

## Primary sources only

- A primary source owns the fact: official docs, source code, a spec, a first-party API, a maintainer's own words on an issue or PR.
- Never rest a claim on a secondary write-up of a source. Follow every claim back to the source that owns it.
- Blogs, forum answers, and Answer Overflow are secondary. Use them to find the primary source, then cite the primary source. When only a secondary source exists, say so and flag it.

## Workflow

1. **Frame the question.** State what you are trying to establish. If the topic is too vague to research and you are running interactively, ask one clarifying question. When delegated as a subagent, proceed and return findings.
2. **Pick the source that owns the answer**, then reach for the tool that reads it:
   - `context7` for library and framework documentation.
   - `grep` for code and docs hosted on GitHub.
   - `gh search` plus raw-file `webfetch` for issues, PRs, comments, and source in a specific repo. `gh api` GETs against a specific issue or PR are fine for maintainer comments.
   - `webfetch` and `websearch` for official docs and specs off GitHub.
   - Answer Overflow only for community context when the primary sources fall short.
3. **Fan out when it helps.** For broad or parallel reading, delegate with the `task` tool to available subagents whose descriptions match the work, such as local codebase discovery or broad read-only upstream dependency/source/docs legwork. Gather their observations; source ranking, claim verification, and synthesis stay your work.
4. **Verify before asserting.** Read the actual source, not just a search snippet. Follow each claim to the line, comment, or section that proves it.
5. **Report with citations.** Every claim carries a source URL or permalink, and prefer a permalink to the exact line or comment over a bare repo or page link. Lead with the answer, then the evidence, then what is still uncertain and the smallest next check that would resolve it.

## Keep the findings

The findings live in the conversation, so persistence reuses the notes vault rather than a direct file write:

- Offer `/note-create` to save a new cited note, or `/note-append` to add to an existing one.
- Do not call the note-writing tool (`dot_note_write` in OpenCode) directly. The notes commands inject the repo note context and manage the vault path.

## Act on the findings

Research feeds the thinking, it does not replace it. When the user wants to turn findings into work, suggest `/plan` so the plan starts from the research context.
