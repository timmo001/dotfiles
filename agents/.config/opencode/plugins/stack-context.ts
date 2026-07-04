/**
 * @file Injects codebase stack-context blocks into prompts.
 *
 * Two entry points share one `<stack-context>` block describing the
 * repository's languages, package ecosystems, and frameworks:
 *
 * - `command.execute.before` injects it for the stack-context command allowlist
 *   (`/inject-stack`, and `/inject-context` alongside branch context).
 * - `chat.message` injects it automatically on the first message of a session
 *   when the working directory is a git repository, so agents start with the
 *   project's stack in their initial context without a slash command. It fires
 *   at most once per session and is skipped outside a repository or when nothing
 *   is detected. Unlike `command.execute.before`, parts added here must carry
 *   `id`, `sessionID`, and `messageID` because OpenCode validates them after
 *   the hook (bare `{ type, text }` triggers "Failed to send prompt").
 *
 * The context is produced by `dot stack-context --json` (the single shared
 * producer, scanning the repository root); this plugin only renders the
 * structured payload into XML. Detection is deterministic and needs no LLM, so
 * the block is reliable non-hallucinated context.
 */

import type { Plugin } from "@opencode-ai/plugin"

type CommandResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string }

type JsonRecord = Record<string, unknown>

/** Outcome of collecting the stack payload: parsed data or a ready error block. */
type StackResult =
  | { readonly kind: "data"; readonly data: JsonRecord }
  | { readonly kind: "error"; readonly block: string }

/**
 * Commands that receive stack context, matched by exact name. `inject-stack` is
 * the dedicated command; `inject-context` also receives it (alongside the
 * branch-context plugin) so one command injects branch and stack context
 * together. Keep private command names in sync with the private overlay.
 */
const TARGET_COMMANDS = new Set(["inject-stack", "inject-context"])

/**
 * Sessions already given the automatic stack block, so `chat.message` injects at
 * most once per session (emulating "inject once at session start", since no
 * session-start hook exists). Lives for the plugin process lifetime.
 */
const injectedSessions = new Set<string>()

const PART_ID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const PART_ID_BODY_LENGTH = 26

let lastPartTimestamp = 0
let partCounter = 0

/** Allocate a monotonic `prt_*` id compatible with OpenCode's part schema. */
const ascendingPartId = (): string => {
  const timestamp = Date.now()
  if (timestamp !== lastPartTimestamp) {
    lastPartTimestamp = timestamp
    partCounter = 0
  }
  partCounter++

  const current = BigInt(timestamp) * 0x1000n + BigInt(partCounter)
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((current >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  ).join("")
  const bytes = crypto.getRandomValues(new Uint8Array(PART_ID_BODY_LENGTH - 12))
  const suffix = Array.from(bytes, (byte) => PART_ID_CHARS[byte % 62]).join("")
  return `prt_${time}${suffix}`
}

/** Build a synthetic text part for the `chat.message` hook (full schema required). */
const syntheticTextPart = (
  sessionID: string,
  messageID: string,
  text: string,
): {
  readonly id: string
  readonly sessionID: string
  readonly messageID: string
  readonly type: "text"
  readonly text: string
  readonly synthetic: true
} => ({
  id: ascendingPartId(),
  sessionID,
  messageID,
  type: "text",
  text,
  synthetic: true,
})

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

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stringField = (record: JsonRecord, field: string): string => {
  const value = record[field]
  return typeof value === "string" ? value : ""
}

const numberField = (record: JsonRecord, field: string): number => {
  const value = record[field]
  return typeof value === "number" ? value : 0
}

const booleanField = (record: JsonRecord, field: string): boolean => {
  const value = record[field]
  return typeof value === "boolean" ? value : false
}

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

const recordArray = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.filter(isRecord) : []

const parseJSON = (text: string): JsonRecord | null => {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Whether the payload detected nothing worth injecting. */
const isEmpty = (data: JsonRecord): boolean =>
  recordArray(data.languages).length === 0 &&
  recordArray(data.ecosystems).length === 0 &&
  recordArray(data.frameworks).length === 0

const formatTag = (name: string, description: string, lines: readonly string[]): string => {
  const body = [`Description: ${description}`, ...lines.filter(Boolean)].join("\n").trim()
  return [`<${name}>`, body || "(none)", `</${name}>`].join("\n")
}

const renderLanguages = (languages: JsonRecord[]): string[] => {
  if (!languages.length) return ["(none detected)"]
  return languages.map((language) => {
    const files = numberField(language, "files")
    const noun = files === 1 ? "file" : "files"
    const locations = stringArray(language.locations)
    const where = locations.length ? ` · ${locations.join(", ")}` : ""
    return `${stringField(language, "name")} — ${files} ${noun}${where}`
  })
}

const renderEcosystems = (ecosystems: JsonRecord[]): string[] => {
  if (!ecosystems.length) return ["(none detected)"]
  return ecosystems.map((ecosystem) => {
    const manifests = stringArray(ecosystem.manifests)
    return `${stringField(ecosystem, "name")}: ${manifests.join(", ") || "(none)"}`
  })
}

const renderFrameworks = (frameworks: JsonRecord[]): string[] => {
  if (!frameworks.length) return ["(none detected)"]
  return frameworks.map(
    (framework) => `${stringField(framework, "name")} (${stringField(framework, "via")})`,
  )
}

const formatErrorContext = (message: string, error: string | null): string => {
  return [
    "<stack-context>",
    formatTag(
      "warnings",
      "The stack context could not be collected; interpret its absence with care.",
      [message, error ? `Error: ${error}` : ""],
    ),
    "</stack-context>",
  ].join("\n\n")
}

const renderStackContext = (data: JsonRecord): string => {
  const scanned = numberField(data, "scannedFiles")
  const truncated = booleanField(data, "truncated") ? "; truncated at cap" : ""
  const warnings = stringArray(data.warnings)

  const lines = [
    "<stack-context>",
    formatTag(
      "context-metadata",
      "How this codebase stack snapshot was generated.",
      [
        "Produced by `dot stack-context --json`. Deterministic (no LLM); prefer it over re-scanning the tree.",
        `Generated at: ${new Date().toISOString()}`,
        `Root: ${stringField(data, "name") || "(unknown)"} (${stringField(data, "root") || "(unknown)"})`,
        `Files scanned: ${scanned}${truncated}`,
      ],
    ),
    formatTag(
      "languages",
      "Detected languages with file counts and their general locations.",
      renderLanguages(recordArray(data.languages)),
    ),
    formatTag(
      "ecosystems",
      "Package ecosystems detected from manifest files.",
      renderEcosystems(recordArray(data.ecosystems)),
    ),
    formatTag(
      "frameworks",
      "Frameworks and tools detected from declared dependencies.",
      renderFrameworks(recordArray(data.frameworks)),
    ),
  ]

  if (warnings.length) {
    lines.push(
      formatTag(
        "warnings",
        "Non-fatal collection issues that may affect interpretation.",
        warnings,
      ),
    )
  }

  lines.push("</stack-context>")
  return lines.join("\n\n")
}

export const StackContextPlugin = (async ({ $ }) => {
  /** Resolve the current git repository root, or null when not in a worktree. */
  const resolveRepoRoot = async (): Promise<string | null> => {
    const result = await run(() => $`git rev-parse --show-toplevel`.text())
    return result.ok && result.text ? result.text : null
  }

  /** Run the producer for `root` (or the cwd when null) and parse its payload. */
  const collectStack = async (root: string | null): Promise<StackResult> => {
    const args = root ? ["stack-context", root, "--json"] : ["stack-context", "--json"]
    const result = await run(() => $`dot ${args}`.text())
    if (!result.ok) {
      return {
        kind: "error",
        block: formatErrorContext(
          "StackContextPlugin could not collect stack context because `dot stack-context` failed.",
          result.error,
        ),
      }
    }
    const data = parseJSON(result.text)
    if (!data) {
      return {
        kind: "error",
        block: formatErrorContext(
          "StackContextPlugin could not parse the `dot stack-context --json` output.",
          null,
        ),
      }
    }
    return { kind: "data", data }
  }

  return {
    "command.execute.before": async (input, output) => {
      if (!TARGET_COMMANDS.has(input.command)) return
      const result = await collectStack(await resolveRepoRoot())
      output.parts.unshift({
        type: "text",
        text: result.kind === "data" ? renderStackContext(result.data) : result.block,
      })
    },
    "chat.message": async (input, output) => {
      if (injectedSessions.has(input.sessionID)) return
      injectedSessions.add(input.sessionID)

      // Automatic injection is scoped to git repositories: it avoids scanning
      // unrelated directories (home, /tmp) and keeps out of non-project sessions.
      const root = await resolveRepoRoot()
      if (!root) return

      const result = await collectStack(root)
      if (result.kind !== "data" || isEmpty(result.data)) return

      const messageID = output.message.id
      if (typeof messageID !== "string" || !messageID) return

      output.parts.unshift(
        syntheticTextPart(input.sessionID, messageID, renderStackContext(result.data)),
      )
    },
  }
}) satisfies Plugin

export default StackContextPlugin
