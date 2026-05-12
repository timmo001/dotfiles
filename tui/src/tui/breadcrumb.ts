import { t, bold, fg } from "@opentui/core"
import type { StyledText } from "@opentui/core"

const SEPARATOR = " › "
const HIGHLIGHT = "#58a6ff"
const DIM = "#8b949e"
const SEPARATOR_COLOR = "#484f58"

/**
 * Format a breadcrumb trail for subview title bars.
 *
 * - **1 part** (root): `bold(blue(parts[0]))` + optional dim subtitle
 * - **2 parts** (subview root): `dim(parts[0]) › bold(blue(parts[1]))` + optional dim subtitle
 * - **3+ parts** (nested): all but last dim-joined with ` › `, last bold blue
 *
 * @param parts - Breadcrumb segments, e.g. `["Dot", "Omarchy", "Theme"]`
 * @param subtitle - Optional subtitle appended after the last segment, e.g. `"repo watcher"`
 */
export function formatBreadcrumb(parts: readonly string[], subtitle?: string): StyledText {
  const sub = subtitle ? fg(DIM)(` — ${subtitle}`) : ""

  if (parts.length <= 1) {
    return t`${bold(fg(HIGHLIGHT)(parts[0] ?? ""))}${sub}`
  }

  if (parts.length === 2) {
    return t`${fg(DIM)(parts[0])}${fg(SEPARATOR_COLOR)(SEPARATOR)}${bold(fg(HIGHLIGHT)(parts[1]))}${sub}`
  }

  // 3+ parts: dim prefix joined with separators, bold last
  const prefix = parts.slice(0, -1).join(SEPARATOR)
  const last = parts[parts.length - 1]
  return t`${fg(DIM)(prefix)}${fg(SEPARATOR_COLOR)(SEPARATOR)}${bold(fg(HIGHLIGHT)(last))}${sub}`
}
