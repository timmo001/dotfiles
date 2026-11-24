/**
 * @file The shapes `dot services status --json` prints: each registered job's
 * health, runs, figures and actions.
 */
import { Schema } from "effect";

/** Overall monitoring state of one registered job, ordered from worst to best. */
export const ServiceHealth = Schema.Literals([
  "failed",
  "missing",
  "inactive",
  "stale",
  "degraded",
  "warning",
  "running",
  "ok",
]);

/** Overall monitoring state of one registered job. */
export type ServiceHealth = typeof ServiceHealth.Type;

/** One service invocation reconstructed from the user journal. */
export const ServiceRun = Schema.Struct({
  /** systemd invocation ID. */
  invocation: Schema.String,
  /** Start time in epoch milliseconds. */
  started: Schema.optional(Schema.Finite),
  /** Completion time in epoch milliseconds. */
  finished: Schema.optional(Schema.Finite),
  /** Outcome of the invocation. */
  result: Schema.Literals([
    "success",
    "warning",
    "skipped",
    "failed",
    "running",
    "stopped",
  ]),
  /** systemd result and exit status for failed runs. */
  detail: Schema.optional(Schema.String),
  /** What the job reported doing, from its last `[RESULT] ` output line. */
  summary: Schema.optional(Schema.String),
});

/** One service invocation reconstructed from the user journal. */
export type ServiceRun = typeof ServiceRun.Type;

/** Repository that owns a registered job's executable. */
export const ServiceRepository = Schema.Struct({
  /** Herdr workspace label. */
  name: Schema.String,
  /** Absolute repository path. */
  path: Schema.String,
});

/** Repository that owns a registered job's executable. */
export type ServiceRepository = typeof ServiceRepository.Type;

/** A number or short string a job reports, with an optional unit and kind. */
export const StatusStat = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  value: Schema.Union([Schema.Finite, Schema.String]),
  unit: Schema.optionalKey(Schema.String),
  /** A hint for clients, such as Home Assistant picking a device class. */
  kind: Schema.optionalKey(
    Schema.Literals(["duration", "size", "timestamp", "count"]),
  ),
});

/** A number or short string a job reports, with an optional unit and kind. */
export type StatusStat = typeof StatusStat.Type;

/** A labelled list of label and value pairs a job reports. */
export const StatusList = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  items: Schema.Array(
    Schema.Struct({ label: Schema.String, value: Schema.String }),
  ),
});

/** A labelled list of label and value pairs a job reports. */
export type StatusList = typeof StatusList.Type;

/** An action `dot services act` runs for an item, as clients show it. */
export const ItemAction = Schema.Struct({
  /** Built-in (`start`, `stop`, `dismiss`, `logs`, `investigate`) or the descriptor's id. */
  id: Schema.String,
  /** Button label. */
  label: Schema.String,
  /** A question for clients to ask before running it. */
  confirm: Schema.optional(Schema.String),
  /** Why it can't run now; it's refused until this clears. */
  disabled: Schema.optional(Schema.String),
});

/** An action `dot services act` runs for an item, as clients show it. */
export type ItemAction = typeof ItemAction.Type;

/** Monitoring snapshot for one registered job. */
export const ServiceStatus = Schema.Struct({
  /** Stable key, the descriptor's `id` or its file name. */
  id: Schema.String,
  /** Registered unit, either a timer or a service; a check's id. */
  unit: Schema.String,
  /** Service unit that does the work; a check's id. */
  service: Schema.String,
  /** Display label. */
  label: Schema.String,
  /** A timer and its oneshot, a long-running service, or a check with no unit. */
  kind: Schema.Literals(["timer", "service", "check"]),
  /** Whether the item's work is under way, so the machine shouldn't turn off. */
  busy: Schema.Boolean,
  /** When the busy work started, when known. */
  busySince: Schema.optional(Schema.Finite),
  /** How far the work is, from 0 to 1, from the status file or check. */
  progress: Schema.optional(Schema.Finite),
  /** Figures from the status file or check. */
  stats: Schema.optional(Schema.Array(StatusStat)),
  /** Short lines from the status file or check. */
  notes: Schema.optional(Schema.Array(Schema.String)),
  /** Lists from the status file or check. */
  lists: Schema.optional(Schema.Array(StatusList)),
  /** What `dot services act` can run for this item. */
  actions: Schema.Array(ItemAction),
  /** Health derived from the monitoring policy. */
  health: ServiceHealth,
  /** Short human summary of the health. */
  summary: Schema.String,
  /** Service ActiveState. */
  activeState: Schema.String,
  /** Most recent run start in epoch milliseconds. */
  lastRun: Schema.optional(Schema.Finite),
  /** Most recent successful run in epoch milliseconds. */
  lastSuccess: Schema.optional(Schema.Finite),
  /** Next timer elapse in epoch milliseconds. */
  nextRun: Schema.optional(Schema.Finite),
  /** Why a timer has no next elapse, when it has none. */
  nextNote: Schema.optional(Schema.String),
  /** How the job runs: its kind first, then schedule or restart policy. */
  tags: Schema.Array(Schema.String),
  /** Consecutive failed runs, excluding skipped invocations. */
  consecutiveFailures: Schema.Finite,
  /** When failures up to then were dismissed by hand, in epoch milliseconds. */
  dismissedAt: Schema.optional(Schema.Finite),
  /** Failed runs before the latest success, when the job has recovered. */
  recoveredAfter: Schema.Finite,
  /** Consecutive failures before the job counts as failed. */
  failAfter: Schema.Finite,
  /** Automatic restarts inside the restart window. */
  restarts: Schema.Finite,
  /** Restart policy, when configured. */
  restartLimit: Schema.optional(
    Schema.Struct({ count: Schema.Finite, within: Schema.Finite }),
  ),
  /** Staleness window in milliseconds, when configured. */
  staleAfter: Schema.optional(Schema.Finite),
  /** Whether failures are recorded as notifications in the journal. */
  notify: Schema.Boolean,
  /** Newest run log, when the job keeps its own logs. */
  latestLog: Schema.optional(
    Schema.Struct({ path: Schema.String, modified: Schema.Finite }),
  ),
  /** Recent runs, newest first. */
  runs: Schema.Array(ServiceRun),
  /** Repository owning the executable, falling back to the public dotfiles. */
  repository: ServiceRepository,
});

/** Monitoring snapshot for one registered job. */
export type ServiceStatus = typeof ServiceStatus.Type;

/** Monitoring snapshot for every registered job, as `dot services status --json` prints it. */
export const ServicesSnapshot = Schema.Struct({
  /** Worst health across every job. */
  worst: ServiceHealth,
  /** Number of jobs in each health state. */
  counts: Schema.Record(Schema.String, Schema.Finite),
  /** The items whose work is under way. */
  busy: Schema.Array(
    Schema.Struct({
      item: Schema.String,
      label: Schema.String,
      since: Schema.optional(Schema.Finite),
    }),
  ),
  /** Every registered job and check. */
  services: Schema.Array(ServiceStatus),
  /** Descriptor files that could not be read. */
  errors: Schema.Array(
    Schema.Struct({ file: Schema.String, message: Schema.String }),
  ),
  /** Directory the descriptors are read from. */
  directory: Schema.String,
});

/** Monitoring snapshot for every registered job. */
export type ServicesSnapshot = typeof ServicesSnapshot.Type;
