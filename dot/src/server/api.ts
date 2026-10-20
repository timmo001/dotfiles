// Shared with the server/ dashboard, so this module only imports effect.
import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";

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

/** Monitoring snapshot for one registered job. */
export const ServiceStatus = Schema.Struct({
  /** Registered unit, either a timer or a service. */
  unit: Schema.String,
  /** Service unit that does the work. */
  service: Schema.String,
  /** Display label. */
  label: Schema.String,
  /** Whether the registered unit is a timer or a long-running service. */
  kind: Schema.Literals(["timer", "service"]),
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
  /** Every registered job. */
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

/** Recent journal lines of one job's service. */
export const ServiceJournal = Schema.Struct({
  /** Registered unit. */
  unit: Schema.String,
  /** journalctl output, oldest line first. */
  text: Schema.String,
});

/** Recent journal lines of one job's service. */
export type ServiceJournal = typeof ServiceJournal.Type;

/** The unit is not registered in the services directory. */
export class ServiceNotFound extends Schema.TaggedError<ServiceNotFound>()(
  "ServiceNotFound",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** The server could not complete the request. */
export class ServerFailure extends Schema.TaggedError<ServerFailure>()(
  "ServerFailure",
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}

/**
 * Header the dashboard sends with every change. Browsers only send custom
 * headers cross-site after a CORS preflight, which the server never allows, so
 * other sites can't start or stop services through a visitor's browser.
 */
export const changeHeaders = { "x-dot-server": Schema.Literal("1") };

const unitParams = { unit: Schema.String };

/** Registered user services: their status, start and stop, and recent journal lines. */
export class ServicesGroup extends HttpApiGroup.make("services")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: ServicesSnapshot,
      error: ServerFailure,
    }),
    HttpApiEndpoint.get("logs", "/:unit/logs", {
      params: unitParams,
      query: { lines: Schema.optional(Schema.FiniteFromString) },
      success: ServiceJournal,
      error: [ServiceNotFound, ServerFailure],
    }),
    HttpApiEndpoint.post("start", "/:unit/start", {
      params: unitParams,
      headers: changeHeaders,
      success: HttpApiSchema.NoContent,
      error: [ServiceNotFound, ServerFailure],
    }),
    HttpApiEndpoint.post("stop", "/:unit/stop", {
      params: unitParams,
      headers: changeHeaders,
      success: HttpApiSchema.NoContent,
      error: [ServiceNotFound, ServerFailure],
    }),
  )
  .prefix("/api/services") {}

/** Liveness for pitchfork's ready and health checks. */
export class SystemGroup extends HttpApiGroup.make("system")
  .add(
    HttpApiEndpoint.get("health", "/health", {
      success: Schema.Struct({ ok: Schema.Boolean }),
    }),
  )
  .prefix("/api") {}

/** The `dot server serve` API, shared by the server and the dashboard. */
export class ServerApi extends HttpApi.make("dot-server")
  .add(ServicesGroup)
  .add(SystemGroup) {}
