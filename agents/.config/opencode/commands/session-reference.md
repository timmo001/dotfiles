---
description: Load another OpenCode session into this conversation by its sidebar title
---

Load the `ctx-agent-history-search` skill, then use `${ARGUMENTS}` as the exact
OpenCode sidebar title of another session.

If `${ARGUMENTS}` is empty, ask one concise question with the `question` tool
for the session title.

Run `opencode session list --format json` and match `${ARGUMENTS}` against its
`title` fields. Prefer an exact, case-sensitive match. This is the source of
truth for the sidebar title; do not try to recover the title from transcript
text with `ctx search`.

If one other session is the clear match, use its OpenCode `id` to show the
complete indexed transcript with
`ctx show session --provider opencode --provider-session <opencode-session-id> --mode full`
and hold that transcript as context for this conversation. If several other
sessions plausibly match, ask the user to select one with the `question` tool,
using each session's title and date as its label, then show the selected
transcript. If none match, report that no session was found and suggest checking
the copied title; do not guess.

Treat this command as read-only context loading. Do not continue the referenced
session's work unless the invocation explicitly asks you to. After loading it,
respond with:

```text
Loaded session: <title>
```

Include the ctx session ID on a second line.
