import { type StyledText, fg, t } from "@opentui/core";
import type { Theme } from "../theme.js";

/** Format an active/inactive two-pane title with a count badge. */
export function formatPaneTitle(
  theme: Theme,
  label: string,
  count: number,
  active: boolean,
  countColor: string,
): StyledText {
  const indicator = active ? "▸" : " ";
  const color = active ? theme.accent : theme.fgMuted;
  return t`${fg(color)(`${indicator} ${label}`)} ${fg(countColor)(`(${count})`)}`;
}
