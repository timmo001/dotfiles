import { join } from "node:path";
import {
  Clock,
  Console,
  Duration,
  Effect,
  FileSystem,
  Option,
  Result,
  Schema,
} from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { herdrRepoOpen } from "./HerdrRepoOpen.js";
import { CONFIG_DIR, STATE_DIR, expandHomePath } from "../lib/paths.js";

/** Registered unit is unknown or its descriptor cannot be used. */
export class ServiceMonitorError extends Schema.TaggedError<ServiceMonitorError>()(
  "ServiceMonitorError",
  { message: Schema.String },
) {}

const Count = Schema.Int.check(Schema.isGreaterThan(0));

const ServiceDescriptor = Schema.Struct({
  unit: Schema.String.check(Schema.isPattern(/^[\w@.:-]+\.(service|timer)$/)),
  label: Schema.optionalKey(Schema.String),
  history: Schema.optionalKey(Count),
  failAfter: Schema.optionalKey(Count),
  staleAfter: Schema.optionalKey(Schema.DurationFromString),
  notify: Schema.optionalKey(Schema.Boolean),
  restartLimit: Schema.optionalKey(
    Schema.Struct({ count: Count, within: Schema.DurationFromString }),
  ),
  logs: Schema.optionalKey(
    Schema.Struct({ dir: Schema.String, file: Schema.String }),
  ),
});

type ServiceDescriptor = typeof ServiceDescriptor.Type;

const decodeDescriptor = Schema.decodeEffect(
  Schema.fromJsonString(ServiceDescriptor),
);

/** Overall monitoring state of one registered job, ordered from worst to best. */
export type ServiceHealth =
  "failed" | "missing" | "inactive" | "stale" | "degraded" | "running" | "ok";

const HEALTH_ORDER: readonly ServiceHealth[] = [
  "failed",
  "missing",
  "inactive",
  "stale",
  "degraded",
  "running",
  "ok",
];

/** One service invocation reconstructed from the user journal. */
export interface ServiceRun {
  /** systemd invocation ID. */
  readonly invocation: string;
  /** Start time in epoch milliseconds. */
  readonly started?: number;
  /** Completion time in epoch milliseconds. */
  readonly finished?: number;
  /** Outcome of the invocation. */
  readonly result: "success" | "failed" | "running" | "stopped";
  /** systemd result and exit status for failed runs. */
  readonly detail?: string;
}

/** Monitoring snapshot for one registered job. */
export interface ServiceStatus {
  /** Registered unit, either a timer or a service. */
  readonly unit: string;
  /** Service unit that does the work. */
  readonly service: string;
  /** Display label. */
  readonly label: string;
  /** Whether the registered unit is a timer or a long-running service. */
  readonly kind: "timer" | "service";
  /** Health derived from the monitoring policy. */
  readonly health: ServiceHealth;
  /** Short human summary of the health. */
  readonly summary: string;
  /** Service ActiveState. */
  readonly activeState: string;
  /** Most recent run start in epoch milliseconds. */
  readonly lastRun?: number;
  /** Most recent successful run in epoch milliseconds. */
  readonly lastSuccess?: number;
  /** Next timer elapse in epoch milliseconds. */
  readonly nextRun?: number;
  /** Failed runs since the last success. */
  readonly consecutiveFailures: number;
  /** Failed runs before the latest success, when the job has recovered. */
  readonly recoveredAfter: number;
  /** Consecutive failures before the job counts as failed. */
  readonly failAfter: number;
  /** Automatic restarts inside the restart window. */
  readonly restarts: number;
  /** Restart policy, when configured. */
  readonly restartLimit?: { readonly count: number; readonly within: number };
  /** Staleness window in milliseconds, when configured. */
  readonly staleAfter?: number;
  /** Whether failures raise desktop notifications. */
  readonly notify: boolean;
  /** Newest run log, when the job keeps its own logs. */
  readonly latestLog?: { readonly path: string; readonly modified: number };
  /** Recent runs, newest first. */
  readonly runs: readonly ServiceRun[];
}

interface Registered {
  readonly file: string;
  readonly descriptor: ServiceDescriptor;
}

const SERVICES_DIR = join(CONFIG_DIR, "dot", "services.d");

const MESSAGE = {
  starting: "7d4958e842da4a758f6c1cdc7b36dcc5",
  started: "39f53479d3a045ac8e11786248231fbf",
  failed: "d9b373ed55a64feb8242e02dbe79a49c",
  exited: "98e322203f7a4ed290d09fe03c09fe15",
  stopped: "9d1aaa27d60140bd96365438aad20286",
  succeeded: "7ad2d189f7e94e70a38c781354912448",
  restart: "5eb03494b6584870a536b337290809b3",
} as const;

const JournalEntry = Schema.Struct({
  __REALTIME_TIMESTAMP: Schema.String,
  MESSAGE_ID: Schema.String,
  USER_INVOCATION_ID: Schema.optionalKey(Schema.String),
  UNIT_RESULT: Schema.optionalKey(Schema.String),
  EXIT_STATUS: Schema.optionalKey(Schema.String),
});

const decodeJournalEntry = Schema.decodeUnknownOption(
  Schema.fromJsonString(JournalEntry),
);

/** Load every descriptor in the services directory, collecting invalid files. */
export const readRegisteredServices = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(SERVICES_DIR))) return { registered: [], errors: [] };

  const registered: Registered[] = [];
  const errors: { file: string; message: string }[] = [];

  for (const name of (yield* fs.readDirectory(SERVICES_DIR)).sort()) {
    if (!name.endsWith(".json")) continue;

    const file = join(SERVICES_DIR, name);

    const decoded = yield* fs.readFileString(file).pipe(
      Effect.flatMap((text) =>
        decodeDescriptor(text, { onExcessProperty: "error" }),
      ),
      Effect.result,
    );

    if (Result.isSuccess(decoded))
      registered.push({ file, descriptor: decoded.success });
    else errors.push({ file, message: decoded.failure.message });
  }

  return { registered, errors };
}).pipe(Effect.withSpan("Services.readRegistered"));

type UnitProperties = Readonly<Record<string, string>>;

const showUnits = Effect.fn("Services.showUnits")(function* (
  units: readonly string[],
) {
  if (units.length === 0) return new Map<string, UnitProperties>();

  const executor = yield* CommandExecutor;

  const output = yield* executor.run("systemctl", [
    "--user",
    "show",
    "--timestamp=unix",
    "--property=Id,LoadState,ActiveState,SubState,Type,UnitFileState,ActiveEnterTimestamp,NextElapseUSecRealtime,LastTriggerUSec,Unit",
    "--",
    ...units,
  ]);

  const blocks = output
    .trim()
    .split(/\n\s*\n/)
    .map((block) =>
      Object.fromEntries(
        block.split("\n").flatMap((line) => {
          const index = line.indexOf("=");

          return index > 0
            ? [[line.slice(0, index), line.slice(index + 1)]]
            : [];
        }),
      ),
    );

  return new Map(units.map((unit, index) => [unit, blocks[index] ?? {}]));
});

const unixMillis = (value: string | undefined) => {
  const seconds = Number(value?.replace(/^@/, ""));

  return value && Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : undefined;
};

const readJournal = Effect.fn("Services.readJournal")(function* (
  service: string,
  limit: number,
) {
  const executor = yield* CommandExecutor;

  const output = yield* executor
    .run("journalctl", [
      "--user",
      "--no-pager",
      "--output=json",
      "--output-fields=MESSAGE_ID,USER_INVOCATION_ID,UNIT_RESULT,EXIT_STATUS",
      "--reverse",
      `--lines=${limit}`,
      `USER_UNIT=${service}`,
      ...Object.values(MESSAGE).map((id) => `MESSAGE_ID=${id}`),
    ])
    .pipe(Effect.orElseSucceed(() => ""));

  return output
    .split("\n")
    .flatMap((line) => Option.toArray(decodeJournalEntry(line)))
    .reverse();
});

interface MutableRun {
  invocation: string;
  started?: number;
  finished?: number;
  result: ServiceRun["result"];
  detail?: string;
  exitStatus?: string;
  restarted?: boolean;
}

function buildRuns(
  entries: readonly (typeof JournalEntry.Type)[],
  oneshot: boolean,
) {
  const runs = new Map<string, MutableRun>();
  const restarts: number[] = [];

  for (const entry of entries) {
    const time = Math.round(Number(entry.__REALTIME_TIMESTAMP) / 1000);

    if (entry.MESSAGE_ID === MESSAGE.restart) restarts.push(time);

    const invocation = entry.USER_INVOCATION_ID;

    if (!invocation) continue;

    let run = runs.get(invocation);

    if (!run) {
      run = { invocation, result: "running" };
      runs.set(invocation, run);
    }

    switch (entry.MESSAGE_ID) {
      case MESSAGE.starting:
        run.started = time;
        break;
      case MESSAGE.started:
        run.started ??= time;

        if (oneshot && run.result === "running") {
          run.result = "success";
          run.finished = time;
        }

        break;
      case MESSAGE.exited:
        run.exitStatus = entry.EXIT_STATUS;
        break;
      case MESSAGE.failed:
        run.result = "failed";
        run.finished = time;
        run.detail = [
          entry.UNIT_RESULT,
          run.exitStatus && `status ${run.exitStatus}`,
        ]
          .filter(Boolean)
          .join(", ");
        break;
      case MESSAGE.succeeded:
        if (run.result !== "failed") {
          run.result = "success";
          run.finished = time;
        }

        break;
      case MESSAGE.restart:
        run.restarted = true;
        break;
      case MESSAGE.stopped:
        if (
          run.result === "running" ||
          (run.result === "failed" && !run.restarted)
        ) {
          run.result = "stopped";
          run.finished = time;
        }

        break;
    }
  }

  const ordered = [...runs.values()]
    .flatMap(
      ({
        exitStatus: _exitStatus,
        restarted: _restarted,
        ...run
      }): ServiceRun[] =>
        run.started !== undefined || run.finished !== undefined ? [run] : [],
    )
    .reverse();

  return { runs: ordered, restarts };
}

const latestLog = Effect.fn("Services.latestLog")(function* (
  logs: NonNullable<ServiceDescriptor["logs"]>,
) {
  const fs = yield* FileSystem.FileSystem;

  const dir = expandHomePath(
    logs.dir
      .replace(/^\$XDG_STATE_HOME(?=\/|$)/, STATE_DIR)
      .replace(/^\$XDG_CONFIG_HOME(?=\/|$)/, CONFIG_DIR)
      .replace(/^\$HOME(?=\/|$)/, "~"),
  );

  const names = yield* fs
    .readDirectory(dir)
    .pipe(Effect.orElseSucceed((): string[] => []));

  let newest: { path: string; modified: number } | undefined;

  for (const name of names) {
    const path = join(dir, name, logs.file);

    const modified = yield* fs.stat(path).pipe(
      Effect.map((info) => Option.getOrUndefined(info.mtime)?.getTime()),
      Effect.orElseSucceed(() => undefined),
    );

    if (modified !== undefined && (!newest || modified > newest.modified))
      newest = { path, modified };
  }

  return newest;
});

function summarise(status: Omit<ServiceStatus, "summary">): string {
  switch (status.health) {
    case "missing":
      return "Unit is not installed";
    case "inactive":
      return status.kind === "timer" ? "Timer is not active" : "Not running";
    case "failed":
      return `Failed ${status.consecutiveFailures} time${status.consecutiveFailures === 1 ? "" : "s"} in a row`;
    case "stale":
      return "No successful run within the expected window";
    case "degraded":
      return status.restartLimit && status.restarts >= status.restartLimit.count
        ? `Restarted ${status.restarts} times recently`
        : `Last run failed (${status.consecutiveFailures} of ${status.failAfter})`;
    case "running":
      return "Running now";
    case "ok":
      if (status.recoveredAfter > 0)
        return `Recovered after ${status.recoveredAfter} failure${status.recoveredAfter === 1 ? "" : "s"}`;

      return status.activeState === "active" ? "Running" : "Last run succeeded";
  }
}

/** Build monitoring snapshots for registered jobs from systemd and the journal. */
export const collectServiceStatus = Effect.fn("Services.collect")(function* (
  registered: readonly Registered[],
) {
  const now = yield* Clock.currentTimeMillis;

  const timers = registered.flatMap(({ descriptor }) =>
    descriptor.unit.endsWith(".timer") ? [descriptor.unit] : [],
  );

  const timerProperties = yield* showUnits(timers);

  const serviceFor = (unit: string) =>
    unit.endsWith(".timer")
      ? timerProperties.get(unit)?.Unit || unit.replace(/\.timer$/, ".service")
      : unit;

  const serviceProperties = yield* showUnits(
    registered.map(({ descriptor }) => serviceFor(descriptor.unit)),
  );

  return yield* Effect.forEach(
    registered,
    Effect.fn("Services.collectOne")(function* ({ descriptor }) {
      const kind = descriptor.unit.endsWith(".timer") ? "timer" : "service";
      const service = serviceFor(descriptor.unit);

      const timer =
        kind === "timer" ? timerProperties.get(descriptor.unit) : undefined;

      const properties = serviceProperties.get(service) ?? {};
      const oneshot = properties.Type === "oneshot";
      const history = descriptor.history ?? 10;
      const failAfter = descriptor.failAfter ?? 1;

      const restartLimit = descriptor.restartLimit && {
        count: descriptor.restartLimit.count,
        within: Duration.toMillis(descriptor.restartLimit.within),
      };

      const staleAfter =
        descriptor.staleAfter && Duration.toMillis(descriptor.staleAfter);

      const { runs, restarts } = buildRuns(
        yield* readJournal(service, Math.max(200, history * 8)),
        oneshot,
      );

      let consecutiveFailures = 0;

      for (const run of runs) {
        if (run.result === "failed") consecutiveFailures++;
        else if (
          run.result === "success" ||
          (!oneshot && run.result === "running")
        )
          break;
      }

      if (properties.ActiveState === "failed")
        consecutiveFailures = Math.max(consecutiveFailures, 1);

      const lastSuccess = runs.find(
        (run) =>
          run.result === "success" || (!oneshot && run.result === "running"),
      );

      const lastSuccessAt = lastSuccess?.finished ?? lastSuccess?.started;

      let recoveredAfter = 0;

      if (consecutiveFailures === 0 && lastSuccess)
        for (const run of runs.slice(runs.indexOf(lastSuccess) + 1, history)) {
          if (run.result === "failed") recoveredAfter++;
          else if (run.result === "success") break;
        }

      const recentRestarts = restartLimit
        ? restarts.filter((time) => now - time <= restartLimit.within).length
        : 0;

      const staleReference =
        lastSuccessAt ?? unixMillis(timer?.ActiveEnterTimestamp);

      const loaded =
        properties.LoadState === "loaded" &&
        (!timer || timer.LoadState === "loaded");

      const health: ServiceHealth = !loaded
        ? "missing"
        : consecutiveFailures >= failAfter
          ? "failed"
          : timer || oneshot
            ? timer && timer.ActiveState !== "active"
              ? "inactive"
              : staleAfter !== undefined &&
                  staleReference !== undefined &&
                  now - staleReference > staleAfter
                ? "stale"
                : consecutiveFailures > 0
                  ? "degraded"
                  : properties.ActiveState === "activating" ||
                      properties.ActiveState === "active"
                    ? "running"
                    : "ok"
            : properties.ActiveState !== "active" &&
                properties.ActiveState !== "activating" &&
                properties.ActiveState !== "reloading"
              ? "inactive"
              : consecutiveFailures > 0 ||
                  (restartLimit !== undefined &&
                    recentRestarts >= restartLimit.count)
                ? "degraded"
                : "ok";

      const partial = {
        unit: descriptor.unit,
        service,
        label: descriptor.label ?? descriptor.unit,
        kind,
        health,
        activeState: properties.ActiveState ?? "unknown",
        lastRun: runs[0]?.started ?? unixMillis(timer?.LastTriggerUSec),
        lastSuccess: lastSuccessAt,
        nextRun: unixMillis(timer?.NextElapseUSecRealtime),
        consecutiveFailures,
        recoveredAfter,
        failAfter,
        restarts: recentRestarts,
        restartLimit,
        staleAfter,
        notify: descriptor.notify ?? true,
        latestLog: descriptor.logs
          ? yield* latestLog(descriptor.logs)
          : undefined,
        runs: runs.slice(0, history),
      } satisfies Omit<ServiceStatus, "summary">;

      return {
        ...partial,
        summary: summarise(partial),
      } satisfies ServiceStatus;
    }),
  );
});

const findRegistered = Effect.fn("Services.findRegistered")(function* (
  unit: string,
) {
  const { registered } = yield* readRegisteredServices;

  const match = registered.find(
    ({ descriptor }) =>
      descriptor.unit === unit ||
      descriptor.unit.replace(/\.timer$/, ".service") === unit,
  );

  if (match) return match;

  const statuses = yield* collectServiceStatus(registered);
  const byService = statuses.findIndex((status) => status.service === unit);

  if (byService >= 0) return registered[byService];

  return yield* new ServiceMonitorError({
    message: `${unit} is not registered in ${SERVICES_DIR}`,
  });
});

/** Print the monitoring snapshot for every registered job. */
export const servicesStatus = Effect.fn("Services.status")(function* (
  json: boolean,
) {
  const { registered, errors } = yield* readRegisteredServices;
  const services = yield* collectServiceStatus(registered);

  const counts = Object.fromEntries(
    HEALTH_ORDER.map((health) => [
      health,
      services.filter((status) => status.health === health).length,
    ]),
  );

  const worst =
    HEALTH_ORDER.find((health) =>
      services.some((status) => status.health === health),
    ) ?? "ok";

  if (json) {
    yield* Console.log(
      JSON.stringify({
        worst,
        counts,
        services,
        errors,
        directory: SERVICES_DIR,
      }),
    );

    return;
  }

  if (services.length === 0)
    yield* Console.log(`No services registered in ${SERVICES_DIR}`);

  for (const status of services)
    yield* Console.log(
      `${status.health.toUpperCase().padEnd(8)} ${status.label} (${status.unit}): ${status.summary}`,
    );

  for (const error of errors)
    yield* Console.error(
      `[WARN] Invalid descriptor ${error.file}: ${error.message}`,
    );
});

/** Start a registered job's service now, restarting long-running services. */
export const servicesStart = Effect.fn("Services.start")(function* (
  unit: string,
) {
  const { descriptor } = yield* findRegistered(unit);
  const [status] = yield* collectServiceStatus([{ file: "", descriptor }]);
  const executor = yield* CommandExecutor;

  yield* executor.run("systemctl", [
    "--user",
    status?.kind === "service" ? "restart" : "start",
    "--no-block",
    "--",
    status?.service ?? descriptor.unit,
  ]);
});

/** Open a registered job's logs in a new tab of the dotfiles Herdr workspace. */
export const servicesLogs = Effect.fn("Services.logs")(function* (
  unit: string,
) {
  const config = yield* Config;
  const { descriptor } = yield* findRegistered(unit);
  const [status] = yield* collectServiceStatus([{ file: "", descriptor }]);

  const viewer = status?.latestLog
    ? ["less", "+F", status.latestLog.path]
    : [
        "journalctl",
        "--user",
        "--unit",
        status?.service ?? descriptor.unit,
        "--lines=500",
        "--follow",
      ];

  yield* herdrRepoOpen({
    label: "dotfiles",
    directory: config.publicDotfiles,
    layout: "tab",
    tabLabel: `${status?.label ?? descriptor.unit} logs`,
    command: viewer
      .map((part) => `'${part.replaceAll("'", `'\\''`)}'`)
      .join(" "),
  });
});

/** Notify about a failed registered job and refresh the shell panel. */
export const servicesNotify = Effect.fn("Services.notify")(function* (
  unit: string,
) {
  const executor = yield* CommandExecutor;
  const { descriptor } = yield* findRegistered(unit);
  const [status] = yield* collectServiceStatus([{ file: "", descriptor }]);

  yield* executor
    .exitCode("omarchy-shell", ["-q", "timmo.services", "refresh"])
    .pipe(Effect.ignore);

  if (!status?.notify || status.health !== "failed") return;

  const lastFailure = status.runs.find((run) => run.result === "failed");

  yield* executor.run("omarchy", [
    "notification",
    "send",
    "--app-name",
    "dot services",
    "-g",
    "󰀦",
    "-u",
    "critical",
    `${status.label} failed`,
    [status.summary, lastFailure?.detail].filter(Boolean).join(" · "),
    "--exec",
    "dot",
    "services",
    "logs",
    status.unit,
  ]);
});
