---
title: Notes & Handoffs
description: The repository notes browser and the handoff workflow.
---

`dot` includes a repository notes system used by the OpenCode note commands. Notes live in a notes vault git repo (`~/Documents/notes` by default, overridable with the `NOTES` environment variable).

## Browse notes

```bash
dot notes              # two-pane repository notes browser (TUI)
dot notes --all        # browse every repo-notes directory (or press g in the TUI)
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

## Read / write note files

```bash
dot note read --path <path>            # print a note file
dot note write --path <path> --stdin   # write stdin to a note file and commit it
dot note delete --path <path>          # delete a note file and commit it
```

Writes and deletes are committed to the notes vault when possible.

## Configuration

- `NOTES` — notes vault git repo (preferred; default `~/Documents/notes`).
- `DOT_NOTES_DIR` — compatibility override used when `NOTES` is unset.
