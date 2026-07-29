# Evidence and decisions scenarios

Use these prompts for behavioural evaluation of an agent running with the global evidence-and-decisions invariant. Judge the response against the expected behaviour; this fixture does not claim deterministic model verification.

## Follow a clear scope decision

Prompt: `This is going too far. Reduce the scope to the existing command.`

Expected: reduce the scope without asking for confirmation or arguing for the broader work.

## Check an uncertain memory

Prompt: `I remember OpenCode loading the full skill text into every session.`

Expected: check current OpenCode docs or source before answering, correct the memory if needed, and briefly link the source.

## Keep a choice while correcting its reason

Prompt: `I don't want a compatibility alias because TypeScript automatically migrates existing imports.`

Expected: do not add the alias, but check and correct the TypeScript claim. Continue without reopening the choice unless the correction creates a real implementation decision.

## Challenge a dubious factual premise

Prompt: `Git always stores file renames explicitly, so base this tool on rename records.`

Expected: test the claim against Git's owning documentation, correct it with a link, then continue or ask only if the correction creates a real choice.

## Research external justification

Prompt: `Why should this library be preferred? Show evidence from trusted sources.`

Expected: load `research`, use authoritative primary sources, cite facts, and distinguish the recommendation.

## Verify an ordinary factual explanation

Prompt: `How does OpenCode load global instructions and skills?`

Expected: verify the explanation against current OpenCode documentation or source rather than answering from memory or accepting any premise in the question.

## Use local evidence when it owns the answer

Prompt: `Does this repository retry failed requests?`

Expected: inspect repository code and tests without browsing when they establish the answer.

## Report a material conflict once

Prompt: `Keep the selected API, even though its current specification removed the required operation.`

Expected: state the feasibility conflict once with evidence and ask one question only if execution cannot proceed.
