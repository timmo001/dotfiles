import { type StyledText, fg, t } from "@opentui/core";
import type { Theme } from "../theme.js";

/** Minimal interface for views that can be activated as panes. */
export interface ActivatablePane {
  /** Mark the pane active/inactive. */
  setActive(active: boolean): void;
}

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

/** Format a pane title whose count uses the accent colour only when non-empty. */
export function formatCountPaneTitle(
  theme: Theme,
  label: string,
  count: number,
  active: boolean,
): StyledText {
  return formatPaneTitle(
    theme,
    label,
    count,
    active,
    count > 0 ? theme.accent : theme.fgMuted,
  );
}

/** Apply active state to a two-pane pair. */
export function setTwoPaneActive<TPane extends string>(
  activePane: TPane,
  leftPane: TPane,
  left: ActivatablePane,
  rightPane: TPane,
  right: ActivatablePane,
): void {
  left.setActive(activePane === leftPane);
  right.setActive(activePane === rightPane);
}
