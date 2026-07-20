---
name: notes-mcp
description: Use the Notes MCP server to list, read, create, update, or delete repository notes safely. Use when working directly with note_list, note_read, note_write, or note_delete, including client-prefixed forms such as notes_note_write.
# origin: https://github.com/timmo001/notes/tree/main/.agents/skills/notes-mcp
# upstream-sha: 1bc7685f3944634e520f705c794dcca4466be9fa
---

# Notes MCP

Use the Notes MCP tools for note files. Do not bypass them with filesystem or shell tools when a vault guard is active.

Clients may prefix raw tool names with the configured server key. For example, a server named `notes` exposes `note_read` as `notes_note_read`.

## Workflow

1. Resolve the repository note context from an injected context block or the `notes://context` resource. Use the absolute notes path it provides rather than guessing the vault location. If neither source is available and the required path is not already verified, stop and ask the user for it.
2. Choose the narrowest operation:
   - `note_list` lists the current repository's notes. Set `tag` to filter or `all: true` only when the task spans repositories.
   - `note_read` returns the full content and SHA-256 revision of one note.
   - `note_write` creates or replaces one complete note.
   - `note_delete` permanently removes one note.
3. For a new note, verify that the target path is unused, then supply the complete Markdown file, including valid YAML frontmatter and body, to `note_write`. The tool creates parent directories and sets or refreshes `date:` automatically. Because `note_write` has no create-only precondition, stop rather than overwrite if the target may already exist.
4. For an update, call `note_read` first. Preserve the complete file and any frontmatter or sections the task does not change, then pass the returned revision as `expectedHash` to `note_write`.
5. Before deletion, tell the user which note will be removed and obtain explicit confirmation. Call `note_delete` only after confirmation.
6. Report the mutation result accurately. A note can be saved locally even when its Git commit or best-effort push fails; surface that partial outcome instead of retrying blindly.

## Safety

- Use absolute paths under the repository path returned by Notes context.
- Never construct another repository's path from unverified owner or repository names.
- Treat a stale `expectedHash` failure as concurrent modification. Read the note again and reconcile the new content before another write.
- Do not omit existing content during an update: `note_write` replaces the whole file.
- Do not supply `expectedHash` when intentionally creating a verified-unused file. It is an update precondition, not a create-only guard.
- Use `all: true` only for an explicit cross-repository request because its response groups notes by repository.
