---
title: Notes & Handoffs
description: The repository notes browser and the handoff workflow.
---

`dot` includes a repository notes system used by the OpenCode note commands. Notes live in a notes vault git repo (`~/Documents/notes` by default, overridable with the `NOTES` environment variable). Inside the vault, notes are filed per repository under `repo-notes/{owner}/{repo}/`, keyed off the current git remote.

There are two ways into the same vault:

- The **`dot notes` / `dot note` CLI** below, for humans browsing and editing notes directly.
- The **OpenCode integration** ([slash commands, plugins, and the handoff skill](#opencode-integration)), for agents creating and loading notes during a session.

## Browse notes

```bash
dot notes              # two-pane repository notes browser (TUI)
dot notes --all        # browse every repo-notes directory (or press v in the TUI)
dot notes list --all   # CLI listing grouped by repo
```

Utility subcommands:

```bash
dot notes root                       # print the notes vault root
dot notes root --repo-notes          # print the repository notes directory
dot notes context --command <name>   # print the OpenCode notes context block
dot notes list --format json         # list current repo notes as JSON
```

## Handoffs

Handoffs are notes tagged `handoff`, used to pass context between agents or sessions.

```bash
dot handoffs           # notes browser filtered to handoff notes (TUI)
dot handoffs --all     # handoffs across every repo
dot handoffs --list    # list handoff notes to stdout
```

`dot handoff` is an alias for `dot handoffs`.

### Priority

Handoffs carry a `priority` of `low`, `medium`, `high`, or `critical`. New handoff drafts start at `medium`, and any handoff without an explicit `priority` is treated as `medium`.

In the handoffs TUI:

- `p` opens a picker (the same style as the menu variant popup) to set the selected handoff's priority. The change is written to frontmatter and committed.
- `g` cycles the grouping mode. The list is grouped into `Critical` / `High` / `Medium` / `Low` sections by default; press `g` again to switch to a flat list. The active sort (`s`) applies within each group.
- `v` toggles the all-repos scope (this moved off `g`).

Priority is a handoff concept, so `p` and priority grouping apply only in the handoffs view; `dot notes` is unaffected. `dot handoffs --list` prefixes each entry with its priority, for example `[High] handoff-auth-refactor.md ...`.

## Read / write note files

```bash
dot note read --path <path>            # print a note file
dot note write --path <path> --stdin   # write stdin to a note file, then commit and push it
dot note delete --path <path>          # delete a note file, then commit and push it
```

Writes and deletes are committed to the notes vault and pushed when it has a remote. The push is best-effort: it reuses the same rebase-then-push as `dot git-commit`, and a failed or skipped push never fails the note operation. Pass `--json` to get the note output and the push status as a JSON object (`{ "output": ..., "push": ... }`); the `repo-notes` plugin uses this to report the push to the interactive session without adding it to the writing agent's tool output.

## OpenCode integration

Agents do not touch the vault with the `dot note` CLI directly. The same files are created and loaded inside an OpenCode session through a set of slash commands, backed by two plugins.

### Slash commands

| Command | What it does |
| --- | --- |
| `/note-create` | Summarise the current conversation into a new note for this repo. |
| `/note-append` | Add new content to an existing note (pick from a ranked list). |
| `/note-reference` | Load one or more notes, any skills they reference, and suggested next steps into context. |
| `/notes-list` | List this repo's notes, optionally filtered by tag. |
| `/notes-search` | Rank this repo's notes against a topic, keyword, or tag. |
| `/handoff` | Write a handoff document for the next agent session. |
| `/handoffs-list` | List handoff notes for this repo (equivalent to `/notes-list handoff`). |

See the [commands reference](/reference/commands/) for the full list.

### How it works

Two OpenCode [plugins](/reference/plugins/) wire the commands to the vault:

- **`repo-notes`** injects a `<repo-note-context>` block at the top of each note command. It runs `dot notes context --command <name>`, which resolves the owner and repo from git and reports the target notes path. For listing and search commands it also includes existing note metadata; `/note-reference` additionally gets the full note bodies. The note tools themselves (`dot_note_read`, `dot_note_write`, `dot_note_delete`, and `dot_note_list`) come from the [`dot mcp` server](/dot/mcp/), not this plugin.
- **`notes-guard`** blocks the built-in `read`, `write`, `edit`, `grep`, `glob`, `list`, and `bash` tools from touching the vault, so the `dot_note_*` tools are the only way in.

So a typical create flow is: run `/note-create` → `repo-notes` injects the repo context → the command summarises the conversation and calls `dot_note_write` → the `dot mcp` server writes the file, commits it, and best-effort pushes the vault, then emits a desktop notification with the push result.

### Handoffs

`/handoff` defers to the [`handoff` skill](/reference/skills/), which compacts the conversation into a `handoff-{slug}.md` note tagged `handoff`. For work spanning multiple phases, branches, or PRs, the skill offers to split the handoff rather than writing one combined note, using a shared `handoff-{feature}-{phase}` naming convention so related handoffs group together under `dot handoffs --list`.

## Configuration

- `NOTES` — notes vault git repo (preferred; default `~/Documents/notes`).
- `DOT_NOTES_DIR` — compatibility override used when `NOTES` is unset.
