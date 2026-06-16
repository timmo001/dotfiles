import type { DiffRepo, ViewId } from "../types.js";

/** Visual state used to colour a dashboard card. */
export type DashboardTone =
  | "attention"
  | "active"
  | "ok"
  | "muted"
  | "prototype";

/** Waybar-compatible module IDs read by the dashboard source layer. */
export type DashboardBarModuleId =
  | "twitch"
  | "temperature"
  | "co2"
  | "voc"
  | "calendar";

/** Runtime state for a bounded status-bar-compatible source command. */
export type DashboardBarStatus =
  | "loading"
  | "ok"
  | "hidden"
  | "missing"
  | "error";

/** One parsed `--bar-json` style source value. */
export interface DashboardBarValue {
  /** Logical source ID. */
  readonly id: DashboardBarModuleId;
  /** Source read status. */
  readonly status: DashboardBarStatus;
  /** Short module text, if present. */
  readonly text: string;
  /** Tooltip/details text, if present. */
  readonly tooltip: string;
  /** Module class field, if present. */
  readonly className: string;
  /** Timestamp of the last source read attempt. */
  readonly updatedAt: Date;
  /** Human-readable source diagnostic for missing/error states. */
  readonly message?: string;
}

/** Live source snapshot used to build dashboard cards. */
export interface DashboardSourceState {
  /** Enriched repo diff data from DotDiff. */
  readonly diffRepos: readonly DiffRepo[];
  /** Parsed one-shot bar module values by source ID. */
  readonly bar: Readonly<Record<DashboardBarModuleId, DashboardBarValue>>;
  /** Timestamp of the last source refresh attempt. */
  readonly lastChecked: Date;
  /** Whether a dashboard source refresh is running. */
  readonly loading: boolean;
  /** Whether at least one dashboard source refresh completed. */
  readonly loaded: boolean;
  /** Optional source-level status message. */
  readonly message?: string;
}

/** A single large dashboard card shown in the Mission Control prototype. */
export interface DashboardCard {
  /** Stable card identifier used for focus and selection. */
  readonly id: string;
  /** Group heading shown above this card column. */
  readonly section: string;
  /** Short card title. */
  readonly title: string;
  /** Main one-line value or status. */
  readonly headline: string;
  /** Tone used for border and headline colour. */
  readonly tone: DashboardTone;
  /** Supporting lines shown below the headline. */
  readonly lines: readonly string[];
  /** Existing TUI view opened with Enter, when available. */
  readonly viewId?: ViewId;
  /** Help text describing the Enter action. */
  readonly actionLabel?: string;
}

/** Dashboard card column used by the stable two-column layout. */
export interface DashboardColumn {
  /** Column heading. */
  readonly title: string;
  /** Cards rendered from top to bottom. */
  readonly cards: readonly DashboardCard[];
}

/** Complete dashboard view model rendered by DashboardView. */
export interface DashboardState {
  /** Main attention summary headline. */
  readonly summaryHeadline: string;
  /** Tone for the summary card. */
  readonly summaryTone: DashboardTone;
  /** Supporting summary lines. */
  readonly summaryLines: readonly string[];
  /** Dashboard columns and cards. */
  readonly columns: readonly DashboardColumn[];
  /** Timestamp of the freshest source included in the dashboard. */
  readonly lastChecked: Date;
  /** Whether any live dashboard source is still loading. */
  readonly loading: boolean;
}
