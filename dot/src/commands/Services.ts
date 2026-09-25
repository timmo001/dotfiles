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
  exitStatuses: Schema.optionalKey(
    Schema.Record(
      Schema.String.check(
        Schema.isPattern(/^(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])$/),
      ),
      Schema.Literals(["warning", "skipped"]),
    ),
  ),
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
  | "failed"
  | "missing"
  | "inactive"
  | "stale"
  | "degraded"
  | "warning"
  | "running"
  | "ok";

const HEALTH_ORDER: readonly ServiceHealth[] = [
  "failed",
  "missing",
  "inactive",
  "stale",
  "degraded",
  "warning",
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
  readonly result:
    "success" | "warning" | "skipped" | "failed" | "running" | "stopped";
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
  /** Why a timer has no next elapse, when it has none. */
  readonly nextNote?: string;
  /** How the job runs: its kind first, then schedule or restart policy. */
  readonly tags: readonly string[];
  /** Consecutive failed runs, excluding skipped invocations. */
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
    "--property=Id,LoadState,ActiveState,SubState,Type,Restart,UnitFileState,ActiveEnterTimestamp,NextElapseUSecRealtime,LastTriggerUSec,Unit,TimersCalendar,TimersMonotonic",
    "--",
    ...units,
  ]);

  const blocks = output
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const properties: Record<string, string> = {};

      for (const line of block.split("\n")) {
        const index = line.indexOf("=");

        if (index <= 0) continue;

        const key = line.slice(0, index);
        const value = line.slice(index + 1);

        properties[key] =
          key in properties ? `${properties[key]}\n${value}` : value;
      }

      return properties;
    });

  return new Map(units.map((unit, index) => [unit, blocks[index] ?? {}]));
});

const TimerList = Schema.Array(
  Schema.Struct({ unit: Schema.String, next: Schema.NullOr(Schema.Finite) }),
);

const nextElapses = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const output = yield* executor
    .run("systemctl", [
      "--user",
      "list-timers",
      "--all",
      "--output=json",
      "--no-pager",
    ])
    .pipe(Effect.orElseSucceed(() => "[]"));

  const timers = Option.getOrElse(
    Schema.decodeOption(Schema.fromJsonString(TimerList))(output),
    () => [],
  );

  return new Map(
    timers.flatMap(({ unit, next }) =>
      next ? [[unit, Math.round(next / 1000)] as const] : [],
    ),
  );
}).pipe(Effect.withSpan("Services.nextElapses"));

const nextCalendarElapse = Effect.fn("Services.nextCalendarElapse")(function* (
  expressions: readonly string[],
) {
  if (expressions.length === 0) return undefined;

  const executor = yield* CommandExecutor;

  const output = yield* executor
    .run("systemd-analyze", ["calendar", "--iterations=1", ...expressions])
    .pipe(Effect.orElseSucceed(() => ""));

  const elapses = [
    ...output.matchAll(/\(in UTC\): \w+ (\S+ \S+) UTC/g),
  ].flatMap((match) => {
    const time = Date.parse(`${match[1]}Z`);

    return Number.isFinite(time) ? [time] : [];
  });

  return elapses.length > 0 ? Math.min(...elapses) : undefined;
});

const humanSpan = (span: string) => span.replace(/(\d)([a-zµ])/g, "$1 $2");

function humanCalendar(expression: string): string {
  const everyMinutes = /^\*-\*-\* \*:0?0\/(\d+):00$/.exec(expression);

  if (everyMinutes) return `every ${everyMinutes[1]} min`;

  const everyHours = /^\*-\*-\* 0?0\/(\d+):00:00$/.exec(expression);

  if (everyHours) return `every ${everyHours[1]} h`;

  const daily = /^\*-\*-\* (\d\d:\d\d):00$/.exec(expression);

  if (daily) return `daily at ${daily[1]}`;

  if (expression === "*-*-* *:00:00") return "hourly";

  return expression;
}

function monotonicTrigger(key: string, span: string): string | undefined {
  switch (key) {
    case "OnActiveUSec":
      return `${span} after start`;
    case "OnBootUSec":
      return `${span} after boot`;
    case "OnStartupUSec":
      return `${span} after login`;
    case "OnUnitActiveUSec":
      return `every ${span}`;
    case "OnUnitInactiveUSec":
      return `${span} after each run`;
  }
}

/** Describe a timer's triggers from `systemctl show` properties. */
function timerTriggers(properties: UnitProperties) {
  const calendar = [
    ...(properties.TimersCalendar ?? "").matchAll(/OnCalendar=([^;]+?) ;/g),
  ].map((match) => match[1] ?? "");

  const monotonic = [
    ...(properties.TimersMonotonic ?? "").matchAll(/(On\w+USec)=([^;]+?) ;/g),
  ].flatMap(([, key = "", span = ""]) => {
    const trigger = monotonicTrigger(key, humanSpan(span));

    return trigger ? [{ trigger, repeating: key.startsWith("OnUnit") }] : [];
  });

  const repeats =
    calendar.length > 0 || monotonic.some(({ repeating }) => repeating);

  return {
    calendar,
    schedule: [
      ...calendar.map(humanCalendar),
      ...monotonic.flatMap(({ trigger, repeating }) =>
        repeating || !repeats ? [trigger] : [],
      ),
    ],
    repeats,
  };
}

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
  exitStatuses: ServiceDescriptor["exitStatuses"],
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
        run.result =
          entry.UNIT_RESULT === "exit-code" && run.exitStatus
            ? (exitStatuses?.[run.exitStatus] ?? "failed")
            : "failed";
        run.finished = time;
        run.detail = [
          entry.UNIT_RESULT,
          run.exitStatus && `status ${run.exitStatus}`,
        ]
          .filter(Boolean)
          .join(", ");

        if (run.result === "warning") run.detail = "Completed with warnings";

        if (run.result === "skipped") run.detail = "No work performed";
        break;
      case MESSAGE.succeeded:
        if (run.result === "running") {
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
      if (status.nextNote === "not scheduled")
        return "Timer has no next run scheduled";

      return status.kind === "timer" ? "Timer is not active" : "Not running";
    case "failed":
      return `Failed ${status.consecutiveFailures} time${status.consecutiveFailures === 1 ? "" : "s"} in a row`;
    case "stale":
      return "No successful run within the expected window";
    case "degraded":
      return status.restartLimit && status.restarts >= status.restartLimit.count
        ? `Restarted ${status.restarts} times recently`
        : `Last run failed (${status.consecutiveFailures} of ${status.failAfter})`;
    case "warning":
      return "Last run completed with warnings";
    case "running":
      return "Running now";
    case "ok":
      if (
        status.runs.length > 0 &&
        status.runs.every((run) => run.result === "skipped")
      )
        return "Last run skipped";

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

  const elapses =
    timers.length > 0 ? yield* nextElapses : new Map<string, number>();

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
        descriptor.exitStatuses,
      );

      const lastCompleted = runs.find(
        (run) =>
          run.result === "success" ||
          run.result === "warning" ||
          run.result === "failed",
      );

      let consecutiveFailures = 0;

      for (const run of runs) {
        if (run.result === "failed") consecutiveFailures++;
        else if (
          run.result === "success" ||
          run.result === "warning" ||
          (!oneshot && run.result === "running")
        )
          break;
      }

      if (
        properties.ActiveState === "failed" &&
        runs[0]?.result !== "warning" &&
        runs[0]?.result !== "skipped"
      )
        consecutiveFailures = Math.max(consecutiveFailures, 1);

      const lastSuccess = runs.find(
        (run) =>
          run.result === "success" || (!oneshot && run.result === "running"),
      );

      const lastSuccessAt = lastSuccess?.finished ?? lastSuccess?.started;

      let recoveredAfter = 0;

      if (
        consecutiveFailures === 0 &&
        lastCompleted?.result === "success" &&
        lastSuccess
      )
        for (const run of runs.slice(runs.indexOf(lastSuccess) + 1, history)) {
          if (run.result === "failed") recoveredAfter++;
          else if (run.result === "success" || run.result === "warning") break;
        }

      const recentRestarts = restartLimit
        ? restarts.filter((time) => now - time <= restartLimit.within).length
        : 0;

      const lastCompletion = runs.find(
        (run) => run.result === "success" || run.result === "warning",
      );

      const staleReference =
        lastCompletion?.finished ??
        lastSuccessAt ??
        unixMillis(timer?.ActiveEnterTimestamp);

      const loaded =
        properties.LoadState === "loaded" &&
        (!timer || timer.LoadState === "loaded");

      const triggers = timer ? timerTriggers(timer) : undefined;

      const serviceBusy =
        properties.ActiveState === "activating" ||
        properties.ActiveState === "active";

      const nextRun = timer
        ? (elapses.get(descriptor.unit) ??
          unixMillis(timer.NextElapseUSecRealtime) ??
          (triggers && triggers.calendar.length > 0
            ? yield* nextCalendarElapse(triggers.calendar)
            : undefined))
        : undefined;

      const unscheduled =
        timer !== undefined &&
        timer.ActiveState === "active" &&
        nextRun === undefined &&
        !serviceBusy &&
        triggers?.repeats === true;

      const nextNote =
        !timer || nextRun !== undefined
          ? undefined
          : timer.ActiveState !== "active"
            ? "timer is off"
            : serviceBusy
              ? "after the current run"
              : unscheduled
                ? "not scheduled"
                : "at next login";

      const tags = timer
        ? ["Timer", ...(triggers?.schedule ?? [])]
        : [
            oneshot ? "One-shot" : "Service",
            ...(properties.Restart && properties.Restart !== "no"
              ? [`restarts ${properties.Restart.replace(/-/g, " ")}`]
              : []),
          ];

      const health: ServiceHealth = !loaded
        ? "missing"
        : consecutiveFailures >= failAfter
          ? "failed"
          : timer || oneshot
            ? (timer && timer.ActiveState !== "active") || unscheduled
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
                    : lastCompleted?.result === "warning"
                      ? "warning"
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
        nextRun,
        nextNote,
        tags,
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
