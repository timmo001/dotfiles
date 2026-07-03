/**
 * @file Routes OpenCode note commands through `dot note` against the notes vault.
 *
 * Backs note-create, note-append, notes-list, notes-search, note-reference,
 * handoff, and handoffs-list by reading and writing note files via the dot CLI.
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin"

const NOTE_COMMANDS = new Set([
  "note-create",
  "note-append",
  "notes-list",
  "notes-search",
  "note-reference",
  "handoff",
  "handoffs-list",
])

interface NoteReadArgs {
  readonly path: string
}

interface NoteWriteArgs extends NoteReadArgs {
  readonly content: string
}

function errorMessage(error: unknown): string {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object") {
    const record = error as Record<string, unknown>
    const stderr = record.stderr
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim()
    const message = record.message
    if (typeof message === "string" && message.trim()) return message.trim()
  }
  return String(error)
}

async function runDot(
  args: readonly string[],
  stdin?: string,
  options?: { trimEnd?: boolean },
): Promise<string> {
  const proc = Bun.spawn(["dot", ...args], {
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })

  if (stdin !== undefined) {
    proc.stdin.write(stdin)
    proc.stdin.end()
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() || stdout.trim() || `dot ${args.join(" ")} failed`,
    )
  }

  return options?.trimEnd === false ? stdout : stdout.trimEnd()
}

/**
 * OpenCode client captured at plugin init so the note tools can toast the
 * interactive session. Toasts show on the TUI regardless of which (sub)agent
 * triggered the write, which is how the push is reported to the interactive
 * user without ever entering the writing agent's tool output.
 */
let toastClient: PluginInput["client"] | undefined

interface NotePushResult {
  readonly ok: boolean
  readonly message: string
  readonly error?: string
}

interface NoteResult {
  readonly output: string
  readonly push: NotePushResult | null
}

function isNotePushResult(value: unknown): value is NotePushResult {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.ok === "boolean" && typeof record.message === "string"
}

function parseNoteResult(raw: string): NoteResult {
  try {
    const parsed = JSON.parse(raw) as { output?: unknown; push?: unknown }
    const output = typeof parsed.output === "string" ? parsed.output : raw
    const push = isNotePushResult(parsed.push) ? parsed.push : null
    return { output, push }
  } catch {
    return { output: raw, push: null }
  }
}

function noteName(path: string): string {
  const parts = path.split("/")
  return parts[parts.length - 1] || path
}

/**
 * Report a best-effort note push to the interactive session as a toast. It is
 * never added to the tool output, so the writing agent is not told about it.
 */
async function showPushToast(path: string, push: NotePushResult): Promise<void> {
  if (!toastClient) return
  try {
    await toastClient.tui.showToast({
      body: push.ok
        ? {
            title: "Notes pushed",
            message: `${noteName(path)}: ${push.message}`,
            variant: "success",
            duration: 4000,
          }
        : {
            title: "Notes push failed",
            message: `${noteName(path)}: ${push.error ?? "unknown error"}`,
            variant: "warning",
            duration: 6000,
          },
    })
  } catch {}
}

const note_read = {
  description:
    "Read the full content of a note file from the notes vault. " +
    "Use this to read an existing note before appending to it. " +
    "This is the ONLY permitted way to read note files — the built-in read tool is blocked for the notes vault.",
  args: {
    path: {
      type: "string",
      description:
        "Absolute path to the note file (e.g. /home/user/Documents/notes/repo-notes/owner/repo/slug.md)",
    },
  },
  async execute(args: NoteReadArgs) {
    try {
      return await runDot(["note", "read", "--path", args.path], undefined, {
        trimEnd: false,
      })
    } catch (error) {
      throw new Error(
        `note_read: failed to read file ${args.path}: ${errorMessage(error)}`,
      )
    }
  },
}

const note_write = {
  description:
    "Write a note file to the notes vault. " +
    "Used exclusively by note-create and note-append to persist generated note content to disk. " +
    "Creates parent directories automatically. " +
    "This is the ONLY permitted way to write note files — the built-in write, edit, and bash tools are blocked for the notes vault.",
  args: {
    path: {
      type: "string",
      description:
        "Absolute path to the note file (e.g. /home/user/Documents/notes/repo-notes/owner/repo/slug.md)",
    },
    content: {
      type: "string",
      description: "Full file content to write, including frontmatter and all sections",
    },
  },
  async execute(args: NoteWriteArgs) {
    try {
      const raw = await runDot(
        ["note", "write", "--path", args.path, "--stdin", "--json"],
        args.content,
      )
      const result = parseNoteResult(raw)
      if (result.push) await showPushToast(args.path, result.push)
      return { title: args.path, output: result.output }
    } catch (error) {
      throw new Error(
        `note_write: failed to write file ${args.path}: ${errorMessage(error)}`,
      )
    }
  },
}

const note_delete = {
  description:
    "Delete a note file from the notes vault. " +
    "Use this to remove notes that are no longer needed (e.g. superseded handoffs, stale references). " +
    "IMPORTANT: Always confirm with the user before calling this tool — deletion is irreversible. " +
    "Show the filename and ask for explicit approval before proceeding. " +
    "This is the ONLY permitted way to delete note files — the built-in bash and edit tools are blocked for the notes vault.",
  args: {
    path: {
      type: "string",
      description:
        "Absolute path to the note file to delete (e.g. /home/user/Documents/notes/repo-notes/owner/repo/slug.md)",
    },
  },
  async execute(args: NoteReadArgs) {
    try {
      const raw = await runDot([
        "note",
        "delete",
        "--path",
        args.path,
        "--json",
      ])
      const result = parseNoteResult(raw)
      if (result.push) await showPushToast(args.path, result.push)
      return { title: args.path, output: result.output }
    } catch (error) {
      throw new Error(
        `note_delete: failed to delete file ${args.path}: ${errorMessage(error)}`,
      )
    }
  },
}

interface NoteListArgs {
  readonly tag?: string
  readonly all?: boolean
}

const note_list = {
  description:
    "List note files in the notes vault for the current repository. " +
    "Returns JSON with filename, name, description, tags, and modification time for each note. " +
    "Optionally filter by tag (e.g. 'handoff') or list notes from all repositories.",
  args: {
    tag: {
      type: "string",
      description:
        "Optional tag to filter notes by (e.g. 'handoff'). Only notes with this tag are returned.",
    },
    all: {
      type: "boolean",
      description:
        "List notes from all repositories instead of just the current one.",
    },
  },
  async execute(args: NoteListArgs) {
    try {
      const cliArgs = ["notes", "list", "--format", "json"]
      if (args.all) cliArgs.push("--all")
      const output = await runDot(cliArgs)
      if (!args.tag) return output

      const parsed = JSON.parse(output)
      const tag = args.tag.toLowerCase()

      if (args.all && Array.isArray(parsed)) {
        // Grouped by repo sections
        const filtered = parsed
          .map((section: { entries: Array<{ tags: string[] }> }) => ({
            ...section,
            entries: section.entries.filter((entry: { tags: string[] }) =>
              entry.tags.some((t: string) => t.toLowerCase() === tag),
            ),
          }))
          .filter((section: { entries: unknown[] }) => section.entries.length > 0)
        return JSON.stringify(filtered, null, 2)
      }

      // Flat list for current repo
      const filtered = parsed.filter((entry: { tags: string[] }) =>
        entry.tags.some((t: string) => t.toLowerCase() === tag),
      )
      return JSON.stringify(filtered, null, 2)
    } catch (error) {
      throw new Error(`note_list: failed to list notes: ${errorMessage(error)}`)
    }
  },
}

export const RepoNotesPlugin = (async ({ client }) => {
  toastClient = client
  return {
    "command.execute.before": async (input, output) => {
      if (!NOTE_COMMANDS.has(input.command)) return
      const text = await runDot(["notes", "context", "--command", input.command])
      output.parts.unshift({ type: "text", text })
    },
    tool: {
      note_read,
      note_write,
      note_delete,
      note_list,
    },
  }
}) satisfies Plugin

export default RepoNotesPlugin
