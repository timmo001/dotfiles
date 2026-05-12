import { StyledText, fg } from "@opentui/core"
import type { TextChunk } from "@opentui/core"

/** A key-action pair displayed in a help bar */
export interface HelpEntry {
  /** Key or key combination (e.g. "↑↓", "Enter", "Esc/Backspace") */
  readonly key: string
  /** Action description (e.g. "navigate", "quit") */
  readonly action: string
}

/** Dim grey used for help bar action text and separators */
const ACTION_COLOR = "#484f58"

/** Light grey used for help bar key names */
const KEY_COLOR = "#8b949e"

/** Separator between key-action pairs (visible width) */
const SEPARATOR = "   "

/**
 * Format help bar entries into styled text with automatic row wrapping.
 *
 * Keys are rendered in light grey ({@link KEY_COLOR}) and actions in
 * dim grey ({@link ACTION_COLOR}) so keyboard shortcuts stand out.
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
  const plainParts = entries.map((e) => `${e.key} ${e.action}`)
  const columns = process.stdout.columns || 80

  // Wrap into rows that fit within terminal width using plain-text widths
  const rows: number[][] = []
  let currentWidth = 0
  let currentRow: number[] = []
  for (let i = 0; i < plainParts.length; i++) {
    const partWidth = plainParts[i].length
    const candidateWidth = currentRow.length > 0
      ? currentWidth + SEPARATOR.length + partWidth
      : partWidth
    if (currentRow.length > 0 && candidateWidth > columns) {
      rows.push(currentRow)
      currentRow = [i]
      currentWidth = partWidth
    } else {
      currentRow.push(i)
      currentWidth = candidateWidth
    }
  }
  if (currentRow.length > 0) rows.push(currentRow)

  // Build styled chunks with colour-coded keys and actions
  const chunks: TextChunk[] = []
  for (let r = 0; r < rows.length; r++) {
    if (r > 0) chunks.push(fg(ACTION_COLOR)("\n"))
    const row = rows[r]
    for (let j = 0; j < row.length; j++) {
      if (j > 0) chunks.push(fg(ACTION_COLOR)(SEPARATOR))
      const entry = entries[row[j]]
      chunks.push(fg(KEY_COLOR)(entry.key))
      chunks.push(fg(ACTION_COLOR)(` ${entry.action}`))
    }
  }

  if (suffix) {
    chunks.push(fg(ACTION_COLOR)("  "))
    chunks.push(suffix)
  }

  return new StyledText(chunks)
}
