---
title: Notes & Handoffs
description: Repository notes and the handoff workflow.
sidebar:
  order: 6
---

Repository notes live in the standalone [`notes`](https://notes.timmo.dev) CLI and MCP server. Dotfiles keeps the OpenCode plugins, slash commands, and handoff skill that consume it.

Notes live in a notes vault git repo (`~/Documents/notes` by default, overridable with `NOTES`). Inside the vault, files are scoped per repository under `repo-notes/{owner}/{repo}/`, keyed off the current git remote.

## Browse notes

```bash
notes list
notes list --all
notes list --format json
notes root --repo-notes
```

## Handoffs

Handoffs are notes tagged `handoff`, used to pass context between agents or sessions.

```bash
notes handoffs
notes handoffs --all
notes handoffs --format json
```

`notes handoff` is an alias for `notes handoffs`.

Handoffs carry a `priority` of `low`, `medium`, `high`, or `critical`. Any handoff without an explicit `priority` is treated as `medium`.

## Process the issue queue

Run `notes-process` to start the isolated OpenCode 2 service if needed, wait for it to become ready, process the current Notes issue queue once using `~/.config/notes/daemon.yml`, then exit. The command reads `OPENCODE_SERVER_PASSWORD` from `~/.config/opencode/.env` and exposes it only to the daemon process.

The supervised capture daemon stays available during transient OpenCode service failures and restarts with the isolated server when systemd recovers it. Explicitly restarting the OpenCode service also restarts the daemon with it.

## Omarchy Shell

The `timmo.notes` Omarchy plugin is published from the [`timmo001/notes`](https://github.com/timmo001/notes/tree/dev/omarchy-plugin) source into [`timmo001/omarchy-notes`](https://github.com/timmo001/omarchy-notes) and pinned here as a managed submodule. It is a keep-loaded service and primary-output bar widget with one keyboard-first panel for the complete Notes workflow.

Press `CTRL+ALT+N` to toggle the panel. The overview provides ranked global search across every repository and opens separate Notes and Handoffs lists. Both lists support repository, tag, and priority filters, modified-time or name sorting in either direction, and repository, priority, or ungrouped display. Selecting a result loads its metadata and rendered Markdown. From there the panel can edit with hash protection, open an external editor, move the note to another repository, set its priority, or delete it after confirmation. Notes and handoffs can also be created in the panel.

Open in agent uses the same Herdr integration detection and ordering as the Git panel: OpenCode 2, OpenCode 1, Pi, Cursor Agent, Claude Code, Codex, GitHub Copilot, OMP, Devin, Droid, Kimi, Kilo, Hermes, Qoder CLI, Qwen, Mastra Code, Antigravity CLI, and Grok. It shows only installed integrations, starts the selected agent in the note's recorded repository checkout, and sends the complete note body and metadata as loaded context.

### Capture locally

Capture is a subview of the Notes panel. Select **Capture note** from the overview, or press `CTRL+ALT+C` to run `omarchy-shell timmo.notes capture` and open it directly. It sends text to the isolated local OpenCode processor through `notes capture`; it does not use the web app or GitHub issue queue. Its repository picker uses notification-enabled repositories from the private `dot-git.yml`, generated into `${XDG_CACHE_HOME:-$HOME/.cache}/dot/notes-capture-repositories.json` by `dot stow`. Automatic leaves the repository unset for the Notes agent to infer.

The subview keeps its draft in `notes-capture-draft.txt`, saves the latest failed submission to `notes-capture-failed-draft.txt`, and disables Send while the local processor is unavailable. `notes-capture-local` remains the private credential adapter: it loads the existing OpenCode service environment and passes the capture text to `/usr/bin/notes` over stdin, so credentials and note text are not placed in Shell settings or process arguments.

## Read / write note files

```bash
notes read --path <path>
notes write --path <path> --stdin
notes delete --path <path>
```

Writes and deletes are committed to the notes vault and pushed when it has a remote. The push is best-effort: a failed or skipped push never fails the note operation.

## OpenCode integration

Agents do not touch the vault with built-in file tools. The same files are created and loaded inside an OpenCode session through slash commands backed by two plugins.

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

- **`repo-notes`** injects a `<repo-note-context>` block at the top of each note command. It runs `notes context --command <name> --json`, which resolves the owner and repo from git and reports the target notes path. For listing and search commands it includes existing note metadata; `/note-reference` reads only the selected note bodies through `notes_note_read`.
- **`notes-guard`** blocks built-in file and shell tools from touching the vault, so the note MCP tools are the only way in.

Agent harnesses prefix MCP server names onto tool calls, so note commands and plugins refer to `notes_note_read`, `notes_note_write`, `notes_note_delete`, and `notes_note_list`. The underlying standalone MCP server registers them as `note_read`, `note_write`, `note_delete`, and `note_list`; see the [Notes MCP docs](https://notes.timmo.dev/mcp/).

So a typical create flow is: run `/note-create` -> `repo-notes` injects the repo context -> the command summarises the conversation and calls the pre-approved `notes_note_write` tool -> `notes mcp` writes the file, commits it, best-effort pushes the vault, then emits a desktop notification with the push result. Read-only agents still deny note writes.

### Handoffs

`/handoff` defers to the [`handoff` skill](/reference/skills/), which compacts the conversation into a `handoff-{slug}.md` note tagged `handoff`. For work spanning multiple phases, branches, or PRs, the skill offers to split the handoff rather than writing one combined note, using a shared `handoff-{feature}-{phase}` naming convention so related handoffs group together under `notes handoffs`.

## Configuration

- `NOTES` - notes vault git repo (preferred; default `~/Documents/notes`).
- `DOT_NOTES_DIR` - compatibility override used when `NOTES` is unset.
