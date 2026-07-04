/**
 * @file Injects codebase stack-context blocks into command prompts before execution.
 *
 * Hooks `command.execute.before` for the stack-context command allowlist and
 * injects a `<stack-context>` XML block describing the repository's languages,
 * package ecosystems, and frameworks. The context itself is produced by
 * `dot stack-context --json` (the single shared producer); this plugin only
 * renders the structured payload into XML. Detection is deterministic and needs
 * no LLM, so the block is reliable non-hallucinated context.
 */

import type { Plugin } from "@opencode-ai/plugin"

type CommandResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string }

type JsonRecord = Record<string, unknown>

/**
 * Commands that receive stack context, matched by exact name. `inject-stack` is
 * the dedicated command; `inject-context` also receives it (alongside the
 * branch-context plugin) so one command injects branch and stack context
 * together. Keep private command names in sync with the private overlay.
 */
const TARGET_COMMANDS = new Set(["inject-stack", "inject-context"])

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
  const buildStackContext = async (): Promise<string> => {
    const result = await run(() => $`dot stack-context --json`.text())
    if (!result.ok) {
      return formatErrorContext(
        "StackContextPlugin could not collect stack context because `dot stack-context` failed.",
        result.error,
      )
    }

    const data = parseJSON(result.text)
    if (!data) {
      return formatErrorContext(
        "StackContextPlugin could not parse the `dot stack-context --json` output.",
        null,
      )
    }

    return renderStackContext(data)
  }

  return {
    "command.execute.before": async (input, output) => {
      if (!TARGET_COMMANDS.has(input.command)) return
      output.parts.unshift({
        type: "text",
        text: await buildStackContext(),
      })
    },
  }
}) satisfies Plugin

export default StackContextPlugin
