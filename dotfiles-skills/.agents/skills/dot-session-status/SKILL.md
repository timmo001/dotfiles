---
name: dot-session-status
description: Query an OpenCode 2 session's selected model, effort variant, context usage and limits with dot session-status. Use before preserving or changing model settings, when asked about context size or the dumb zone, or when context pressure could affect continuing, compacting or handing off work.
license: Apache-2.0
compatibility: Requires the dot CLI and the host's configured OpenCode 2 launcher.
---

# Session Status

## Query The Right Session

1. For yourself, take the exact `Current conversation session ID` from the
   harness's injected environment context. It is prompt context, not a promised
   shell environment variable. Do not infer identity from the current directory,
   focused pane, latest session or transcript title. If the ID is unavailable,
   ask for it rather than inspecting an arbitrary session.
2. Run `dot session-status <session-id> --json`. Use the same command with an
   explicitly supplied ID for another session. Herdr's reported OpenCode session
   ID is also suitable when inspecting an already identified worker.
3. Use `model` for the selected provider, model ID and optional variant;
   `availableVariants` and `limits` come from its project-specific catalogue.
   An omitted variant means no explicit variant, not necessarily low effort.
   The injected model identity alone does not include the effort variant.
4. Keep the output compact: model and variant, measured context tokens and
   percentage, measurement age, pressure, latest compaction, and any limitation
   that affects the decision. Include cumulative usage and cost when requested;
   never treat those totals as the context window.

## Read Context Pressure

- `context.measurement` describes the latest completed assistant response with
  recorded usage. Its total includes non-cached input, cache reads and writes,
  output and reasoning, matching OpenCode's context display. Cached input still
  occupies context. The measurement identifies the model that produced it.
- `context.usedTokens`, `percent` and `remainingTokens` are a snapshot, not an
  exact count for the next request. New prompts, tool results and instruction
  changes may have added tokens. Check the age and `notes` before relying on it.
- Check `inputPercent` too: some models advertise an input limit smaller than
  their context window. `pressure` uses whichever measured percentage is higher,
  identified by `limitingBudget`. Remaining input and context tokens are separate;
  neither is a guarantee of space for the next request's tools and output.
- Unknown means unknown. A new session, a compaction without a subsequent
  measurement, changed model/variant, staged revert or incomplete lookup can
  prevent a usable percentage. Do not substitute cumulative tokens or zero.
- The default `--warn-at 70` is a configurable workflow threshold. `review`
  means reassess the next chunk of work; `below-threshold` does not certify
  reasoning quality. There is no measured universal "dumb zone" in this report.
- Combine context pressure with observed behaviour: repeatedly losing the task
  boundary, forgetting settled decisions, rereading the same evidence or failing
  to reconcile contradictions. Before a large new phase, query again if the
  result could change whether to continue, compact or hand off. Do not poll after
  every tool call.

## Act On The Result

- Continue bounded work when the remaining context and observed behaviour support
  it. Keep large raw output out of the conversation; inspect targeted sections.
- If pressure or repeated mistakes warrant a fresh start, use `handoff` to retain
  decisions, current changes and remaining checks. Use `task-focus` for changing
  tasks, and `session-coordination` for a useful independent Herdr assignment.
- A stronger model or higher effort does not itself shrink context. Query before
  preserving or changing settings, and use `dot-repositories` for supported
  Herdr model switches. Do not silently change the user's model selection.
- Querying is read-only. The report does not authorise compaction, model changes,
  new workers or closing the current session; follow the owning workflows.

See `dot session-status --help` for flags. The command uses the OpenCode session,
filtered message and location-scoped model APIs; it returns usage metadata rather
than dumping message text into the conversation.
