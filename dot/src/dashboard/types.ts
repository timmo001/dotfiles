import type { DiffRepo, ViewId } from "../types.js";

/** Visual state used to colour a dashboard card. */
export type DashboardTone =
  | "attention"
  | "active"
  | "ok"
  | "muted"
  | "prototype";

/** Bounded external source IDs read by the dashboard source layer. */
export type DashboardBarModuleId =
  | "twitch"
  | "temperature"
  | "co2"
  | "voc"
  | "calendar"
  | "todo_my_tasks"
  | "todo_work";

/** Runtime state for a bounded dashboard source command. */
export type DashboardBarStatus =
  | "loading"
  | "ok"
  | "hidden"
  | "missing"
  | "error";

/** One parsed JSON source value with `text`, `tooltip`, and `class` fields. */
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
  /** Unit of measurement appended to the reading, from source config. */
  readonly unit?: string;
  /** Structured Home Assistant entity name (device + entity), if present. */
  readonly name?: string;
  /** Timestamp of the last source read attempt. */
  readonly updatedAt: Date;
  /** Human-readable source diagnostic for missing/error states. */
  readonly message?: string;
}

/** Live source snapshot used to build dashboard cards. */
export interface DashboardSourceState {
  /** Enriched repo diff data from DotDiff. */
  readonly diffRepos: readonly DiffRepo[];
  /** Parsed one-shot dashboard source values by source ID. */
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

/** A single large dashboard card. */
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
  /** Shell command run when Enter activates this card, when available. */
  readonly command?: string;
  /** How a dashboard shell command should be run. Defaults to silent. */
  readonly commandMode?: "silent" | "suspend" | "exit";
  /** Help text describing the Enter action. */
  readonly actionLabel?: string;
}

/** Dashboard card section used by the stacked, wrapping grid layout. */
export interface DashboardSection {
  /** Section heading shown above the card grid. */
  readonly title: string;
  /** Cards wrapped into a grid within the section. */
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
  /** Dashboard sections and cards. */
  readonly sections: readonly DashboardSection[];
  /** Timestamp of the freshest source included in the dashboard. */
  readonly lastChecked: Date;
  /** Whether any live dashboard source is still loading. */
  readonly loading: boolean;
}
