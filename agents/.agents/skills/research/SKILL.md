---
name: research
description: Investigate a topic against primary sources and return cited findings, comparing credible maintainer and contributor perspectives when judgement is involved. Use when the user wants a topic researched, docs, API, or spec facts gathered, an external library or GitHub behaviour verified, competing views compared, or reading legwork delegated to a background agent.
---

# Research

Answer a question by reading the sources that own the answer, then hand back findings with every claim tied to its source. This is external primary-source research, distinct from `/investigate` (local triage and diagnosis) and `/explore-codebase` (internal codebase discovery).

## Source discipline

- A primary source owns the fact: official docs, source code, a spec, a first-party API, a maintainer's own words on an issue or PR.
- Never rest a claim on a secondary write-up of a source. Follow every claim back to the source that owns it.
- Third-party blogs, forum answers, and Answer Overflow are secondary. Use them to find the primary source, then cite the primary source. When only a secondary source exists, say so and flag it.
- A person's own writing is primary evidence of their view or experience, not automatically of project policy or a universal technical fact. Distinguish project policy, implemented behaviour, adopted practice, personal opinion, social sentiment, and measured evidence.

## Compare arguments, not reputations

- Do not rank people globally or treat a familiar name, maintainer title, employer, stars, followers, citations, votes, or repeated agreement as proof.
- Weigh each source for the claim at hand: direct involvement, relevant public work, inspectable reasoning or implementation, tests or reproducible methods, applicability, recency, caveats, incentives, and engagement with strong objections.
- Prefer visible effort over status. Code, measurements, concrete examples, trade-offs, limitations, and responses to criticism carry more weight than confidence or credentials alone.
- Use known maintainers, contributors, projects, locally used software, and skill lineages as discovery seeds, not an allowlist. Actively look beyond the familiar pool for relevant credible voices.
- Do not manufacture balance. Include a challenge only when it is relevant and technically credible, and do not let several weak endorsements outvote one unresolved technical objection.
- When present, read `references/user-source-context.md` as optional private discovery context. Its names and projects are unordered leads, never authority or required coverage. The public workflow must work without it.

## Workflow

1. **Frame claims before names.** State what you are trying to establish. If the topic is too vague to research and you are running interactively, ask one clarifying question. When delegated as a subagent, proceed and return findings.
2. **Choose the evidence shape.** For a direct API, specification, version, or implementation fact, read the owning source and stop when it establishes the answer. For a recommendation, disputed claim, design question, or request for sentiment, build a proportionate source portfolio from the owning project, directly relevant maintainers or contributors, independent or downstream experience, empirical evidence when measurable, and the strongest credible disagreement. These are useful roles, not quotas.
3. **Pick the tool that reads the source:**
   - `context7` for library and framework documentation.
   - `grep` for code and docs hosted on GitHub.
   - GitHub read and search tools for issues, PRs, commits, repository metadata, and role verification.
   - `webfetch` and `websearch` for official docs and specs off GitHub.
   - Answer Overflow only for community context when the primary sources fall short.
4. **Fan out once when it helps.** When running interactively, broad or parallel reading may be delegated to terminal read-only subagents such as `explore`, `general-readonly`, or `researcher-readonly`. Divide by independent evidence axis or source community and ask for facts, attribution, scope, tensions, and caveats without prescribing a conclusion. When running as a delegated subagent, do not use `task`; complete the assigned reading yourself and return it to the parent. Claim verification, comparison, and synthesis stay with the interactive researcher.
5. **Inspect large output deliberately.** Do not use `head` or `tail` to trim normal command output. For genuinely huge source or tool output, search it with `Grep` or read targeted `Read` offsets; if OpenCode saves a full `tool-output` file, delegate targeted inspection to `explore` when that preserves parent context.
6. **Verify attribution and scope.** Read the actual source, not just a search snippet. Verify the author's relationship to the project, the date or version, what evidence they provide, and whether the statement is policy, implementation, experience, opinion, or measurement. Do not generalise a narrow statement beyond its stated context.
7. **Compare the strongest cases.** For evaluative work, explain the strongest support, strongest credible challenge, agreements, real tensions, decisive evidence, and remaining uncertainty. Recommend the position best supported for the user's context, even when it comes from an unfamiliar source. Do not settle disagreement by counting sources.
8. **Report with citations.** Every factual claim carries a source URL or permalink. Prefer the exact line, comment, commit, or section over a bare repo or page link. Clearly label source facts and your synthesis, and include limitations and the smallest next check that would resolve material uncertainty. Keep direct factual answers concise; use fuller comparison only when the question needs judgement.

## Keep the findings

The findings live in the conversation, so persistence reuses the notes vault rather than a direct file write:

- Offer `/note-create` to save a new cited note, or `/note-append` to add to an existing one.
- Do not call the note-writing tool (`notes_note_write` in OpenCode) directly. The notes commands inject the repo note context and manage the vault path.

## Act on the findings

Research feeds the thinking, it does not replace it. When the user wants to turn findings into work, suggest `/plan` so the plan starts from the research context.
