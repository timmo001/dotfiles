/**
 * @file Injects repo-note context into OpenCode note commands.
 *
 * Runs `notes context --json` before note-create, note-append, notes-list,
 * notes-search, note-reference, handoff, and handoffs-list so each command sees
 * the resolved owner, repo, and notes path. Reading, writing, and deleting note
 * files is handled by the standalone `notes mcp` server's note tools, not this
 * plugin.
 */

import type { Plugin } from "@opencode-ai/plugin"

const NOTE_COMMANDS = new Set([
  "note-create",
  "note-append",
  "notes-list",
  "notes-search",
  "note-reference",
  "handoff",
  "handoffs-list",
])
const COMMANDS_NEEDING_LIST = new Set([
  "note-append",
  "notes-list",
  "notes-search",
  "note-reference",
  "handoffs-list",
])

type JsonRecord = Record<string, unknown>

interface NoteEntry {
  readonly filename: string
  readonly filePath: string
  readonly name: string | null
  readonly description: string | null
  readonly tags: readonly string[]
  readonly mtime: number
}

interface RepoNotePayload {
  readonly generatedAt: string
  readonly command: string
  readonly notesRoot: string
  readonly repoNotesRoot: string
  readonly repository?: {
    readonly owner: string
    readonly repo: string
    readonly remote: string
    readonly remoteUrl: string
  }
  readonly notesPath?: string
  readonly notesExist?: boolean
  readonly entries: readonly NoteEntry[]
  readonly warnings: readonly string[]
  readonly error?: { readonly message: string; readonly detail?: string }
}

type CommandResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string }

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []

const errorMessage = (error: unknown): string => {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  if (typeof error === "object") {
    const record = error as Record<string, unknown>
    const stderrValue = record.stderr
    const stderr = typeof stderrValue === "string" ? stderrValue.trim() : ""
    if (stderr) return stderr
    const message = record.message
    if (typeof message === "string" && message) return message
  }
  return String(error)
}

const run = async (execute: () => Promise<unknown>): Promise<CommandResult> => {
  try {
    const output = await execute()
    return { ok: true, text: String(output).trim() }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

const parseJSON = (text: string): JsonRecord | null => {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")

function entryFrom(value: unknown): NoteEntry | null {
  if (!isRecord(value)) return null
  if (typeof value.filename !== "string") return null
  if (typeof value.filePath !== "string") return null
  const tags = stringArray(value.tags)
  return {
    filename: value.filename,
    filePath: value.filePath,
    name: typeof value.name === "string" ? value.name : null,
    description:
      typeof value.description === "string" ? value.description : null,
    tags,
    mtime: typeof value.mtime === "number" ? value.mtime : 0,
  }
}

function payloadFrom(value: JsonRecord): RepoNotePayload | null {
  const generatedAt = value.generatedAt
  const command = value.command
  const notesRoot = value.notesRoot
  const repoNotesRoot = value.repoNotesRoot
  if (
    typeof generatedAt !== "string" ||
    typeof command !== "string" ||
    typeof notesRoot !== "string" ||
    typeof repoNotesRoot !== "string"
  ) {
    return null
  }

  const repository = isRecord(value.repository)
    ? {
        owner: typeof value.repository.owner === "string" ? value.repository.owner : "",
        repo: typeof value.repository.repo === "string" ? value.repository.repo : "",
        remote:
          typeof value.repository.remote === "string" ? value.repository.remote : "",
        remoteUrl:
          typeof value.repository.remoteUrl === "string"
            ? value.repository.remoteUrl
            : "",
      }
    : undefined
  const error = isRecord(value.error)
    ? {
        message: typeof value.error.message === "string" ? value.error.message : "",
        detail: typeof value.error.detail === "string" ? value.error.detail : undefined,
      }
    : undefined

  return {
    generatedAt,
    command,
    notesRoot,
    repoNotesRoot,
    repository,
    notesPath: typeof value.notesPath === "string" ? value.notesPath : undefined,
    notesExist: typeof value.notesExist === "boolean" ? value.notesExist : undefined,
    entries: Array.isArray(value.entries)
      ? value.entries.map(entryFrom).filter((entry): entry is NoteEntry => !!entry)
      : [],
    warnings: stringArray(value.warnings),
    error,
  }
}

const formatTag = (
  name: string,
  description: string,
  lines: readonly string[],
): string => {
  const body = [
    `Description: ${description}`,
    ...lines.filter(Boolean).map((line) => escapeXml(line)),
  ]
    .join("\n")
    .trim()
  return [`<${name}>`, body || "(empty)", `</${name}>`].join("\n")
}

function formatNoteLabel(entry: NoteEntry): string {
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(entry.mtime * 1000))
  const tagPart = entry.tags.length ? ` [tags: ${entry.tags.join(", ")}]` : ""
  if (entry.name && entry.description) {
    return `${entry.filename} - ${entry.name}: ${entry.description}${tagPart} (last modified: ${date})`
  }
  if (entry.name) {
    return `${entry.filename} - ${entry.name}${tagPart} (last modified: ${date})`
  }
  return `${entry.filename}${tagPart} (last modified: ${date})`
}

const formatErrorContext = (message: string, error: string | null): string =>
  [
    "<repo-note-context>",
    formatTag(
      "metadata",
      "Information about how this repo-note context was generated.",
      [`Generated at: ${new Date().toISOString()}`],
    ),
    formatTag("warnings", "Issues encountered while collecting repo context.", [
      message,
      error ? `Error: ${error}` : "",
    ]),
    "</repo-note-context>",
  ].join("\n\n")

function renderRepoNoteContext(payload: RepoNotePayload): string {
  if (payload.error) return formatErrorContext(payload.error.message, payload.error.detail ?? null)

  const repository = payload.repository
  const parts = [
    "<repo-note-context>",
    formatTag("metadata", "How this context was generated.", [
      "RepoNotesPlugin generated this context from `notes context --json`. Use it to locate and manage notes for this repository.",
      `Generated at: ${payload.generatedAt}`,
    ]),
    formatTag("repository", "Current repository identity and resolved notes path.", [
      `Owner: ${repository?.owner || "(unknown)"}`,
      `Repo: ${repository?.repo || "(unknown)"}`,
      `Remote: ${repository ? `${repository.remote} (${repository.remoteUrl})` : "(unknown)"}`,
      `Notes root: ${payload.notesRoot}`,
      `Notes path: ${payload.notesPath ?? "(unknown)"}`,
      `Notes directory exists: ${payload.notesExist ? "yes" : "no"}`,
    ]),
  ]

  if (COMMANDS_NEEDING_LIST.has(payload.command)) {
    const noteLines =
      payload.entries.length > 0
        ? payload.entries.map(formatNoteLabel)
        : payload.notesExist
          ? ["(no .md files found in notes directory)"]
          : ["(notes directory does not exist yet)"]
    parts.push(
      formatTag(
        "existing-notes",
        "Existing note files for this repository, sorted newest-first by modification time.",
        noteLines,
      ),
    )
  }

  if (payload.warnings.length) {
    parts.push(
      formatTag(
        "warnings",
        "Non-fatal issues encountered while collecting repo note context.",
        payload.warnings,
      ),
    )
  }

  parts.push("</repo-note-context>")
  return parts.join("\n\n")
}

export const RepoNotesPlugin = (async ({ $, directory }) => {
  const collectContext = async (command: string): Promise<string> => {
    const result = await run(() =>
      $`notes ${["context", "--command", command, "--json"]}`
        .cwd(directory)
        .text(),
    )
    if (!result.ok) {
      return formatErrorContext(
        "RepoNotesPlugin could not collect note context because `notes context --json` failed.",
        result.error,
      )
    }
    const data = parseJSON(result.text)
    const payload = data ? payloadFrom(data) : null
    if (!payload) {
      return formatErrorContext(
        "RepoNotesPlugin could not parse the `notes context --json` output.",
        null,
      )
    }
    return renderRepoNoteContext(payload)
  }

  return {
    "command.execute.before": async (input, output) => {
      if (!NOTE_COMMANDS.has(input.command)) return
      output.parts.unshift({ type: "text", text: await collectContext(input.command) })
    },
  }
}) satisfies Plugin

export default RepoNotesPlugin
