import type { BoxRenderable, SelectRenderable } from "@opentui/core";

/** Colour configuration for a pane in its active state */
export interface PaneActiveStyle {
  readonly selectedBackgroundColor: string;
  readonly selectedTextColor: string;
  readonly selectedDescriptionColor: string;
}

/** A pane descriptor with its renderable references and colour styles */
export interface TwoPaneDescriptor {
  /** The SelectRenderable that receives focus/blur */
  readonly select: SelectRenderable;
  /** The container whose opacity is toggled */
  readonly container: BoxRenderable;
  /** Colours applied when this pane is active (focused) */
  readonly activeStyle: PaneActiveStyle;
  /** Colours applied when this pane is inactive (dimmed) */
  readonly inactiveStyle: PaneActiveStyle;
}

/** Dimmed opacity for the inactive pane */
const INACTIVE_OPACITY = 0.45;

/**
 * Focus one pane of a two-pane layout, blurring the other.
 *
 * Sets highlight colours and opacity so the active pane is visually prominent
 * and the inactive pane is dimmed.
 */
export function focusTwoPane(
  active: TwoPaneDescriptor,
  inactive: TwoPaneDescriptor,
): void {
  inactive.select.blur();
  active.select.focus();

  // Active pane: restore highlight colours, full opacity
  active.select.selectedBackgroundColor =
    active.activeStyle.selectedBackgroundColor;
  active.select.selectedTextColor = active.activeStyle.selectedTextColor;
  active.select.selectedDescriptionColor =
    active.activeStyle.selectedDescriptionColor;
  active.container.opacity = 1;

  // Inactive pane: hide highlight (match background), dim opacity
  inactive.select.selectedBackgroundColor =
    inactive.inactiveStyle.selectedBackgroundColor;
  inactive.select.selectedTextColor = inactive.inactiveStyle.selectedTextColor;
  inactive.select.selectedDescriptionColor =
    inactive.inactiveStyle.selectedDescriptionColor;
  inactive.container.opacity = INACTIVE_OPACITY;
}
