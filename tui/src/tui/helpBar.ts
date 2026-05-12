import { t, fg } from "@opentui/core"
import type { StyledText, TextChunk } from "@opentui/core"

/** A key-action pair displayed in a help bar */
export interface HelpEntry {
  /** Key or key combination (e.g. "↑↓", "Enter", "Esc/Backspace") */
  readonly key: string
  /** Action description (e.g. "navigate", "quit") */
  readonly action: string
}

/** Dim grey used for help bar text */
const HELP_COLOR = "#484f58"

/** Separator between key-action pairs */
const SEPARATOR = "   "

/**
 * Format help bar entries into styled text with automatic row wrapping.
 *
 * Joins entries as `"key action"` pairs separated by triple spaces.
 * When the total width exceeds terminal columns, entries wrap onto
 * multiple rows.
 *
 * @param entries - Key-action pairs to display
 * @param suffix - Optional styled suffix appended after the last row (e.g. model ID badge)
 */
export function formatHelpBar(
  entries: readonly HelpEntry[],
  suffix?: TextChunk,
): StyledText {
  const parts = entries.map((e) => `${e.key} ${e.action}`)
  const columns = process.stdout.columns || 80

  // Wrap into rows that fit within terminal width
  const rows: string[] = []
  let current = ""
  for (const part of parts) {
    const candidate = current ? current + SEPARATOR + part : part
    if (current && candidate.length > columns) {
      rows.push(current)
      current = part
    } else {
      current = candidate
    }
  }
  if (current) rows.push(current)

  const text = rows.join("\n")

  if (suffix) {
    return t`${fg(HELP_COLOR)(text)}  ${suffix}`
  }
  return t`${fg(HELP_COLOR)(text)}`
}
