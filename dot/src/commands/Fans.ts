import { join } from "node:path";
import { BridgeClient, resolveSocketPath } from "@timmo001/effect-ha-bridge";
import {
  Cause,
  Clock,
  Console,
  Deferred,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Option,
  Ref,
  Schedule,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { CONFIG_DIR, STATE_DIR } from "../lib/paths.js";
import { type ReportedStatus, writeReportedStatus } from "./Services.js";

/** Fan controller configuration is missing or invalid. */
export class FansError extends Schema.TaggedError<FansError>()("FansError", {
  message: Schema.String,
}) {}

const CONFIG_FILE = join(CONFIG_DIR, "dot", "fans.yml");

/** Status file read by `dot services` through the `dot-fans` descriptor. */
const STATUS_FILE = join(STATE_DIR, "dot", "fans", "status.json");

const FIRST_READING_TIMEOUT = "30 seconds";

const RETRY_MIN = 1_000;

const RETRY_MAX = 60_000;

const HWMON_DIR = "/sys/class/hwmon";

const CPU_POLL = "5 seconds";

/** CPU readings averaged over a minute, so Tctl's boost spikes don't swing the fans. */
const CPU_WINDOW = 12;

const Percent = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 100 }),
);

const Ramp = Schema.Struct({ from: Schema.Finite, to: Schema.Finite });

type Ramp = typeof Ramp.Type;

const FansConfig = Schema.Struct({
  entity: Schema.String.check(Schema.isPattern(/^\w+\.\w+$/)),
  device: Schema.String,
  channels: Schema.NonEmptyArray(
    Schema.String.check(Schema.isPattern(/^fan\d+$/)),
  ),
  ramp: Ramp,
  speed: Schema.Struct({ min: Percent, max: Percent }),
  cpu: Schema.optionalKey(
    Schema.Struct({ hwmon: Schema.String, label: Schema.String, ramp: Ramp }),
  ),
});

type FansConfig = typeof FansConfig.Type;

/** Room and CPU inputs combined decide the speed, so only the room part is held while the bridge is away. */
interface RoomState {
  readonly health: "ok" | "degraded";
  readonly target: number;
  readonly summary: string;
}

const decodeConfig = Schema.decodeUnknownEffect(FansConfig);

const loadConfig = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const text = yield* fs
    .readFileString(CONFIG_FILE)
    .pipe(
      Effect.mapError(
        () => new FansError({ message: `Could not read ${CONFIG_FILE}` }),
      ),
    );

  const config = yield* Effect.try(() => Bun.YAML.parse(text)).pipe(
    Effect.flatMap((parsed) =>
      decodeConfig(parsed, { onExcessProperty: "error" }),
    ),
    Effect.mapError(
      (error) =>
        new FansError({ message: `Invalid ${CONFIG_FILE}: ${error.message}` }),
    ),
  );

  if (
    config.ramp.from >= config.ramp.to ||
    (config.cpu !== undefined && config.cpu.ramp.from >= config.cpu.ramp.to) ||
    config.speed.min > config.speed.max
  )
    return yield* new FansError({
      message: `Invalid ${CONFIG_FILE}: ramp.from must be below ramp.to (also for cpu.ramp) and speed.min at most speed.max`,
    });

  return config;
}).pipe(Effect.withSpan("Fans.loadConfig"));

/** Find the `tempN_input` file whose label matches, since hwmon numbering changes between boots. */
const findHwmonInput = Effect.fn("Fans.findHwmonInput")(
  function* (hwmon: string, label: string) {
    const fs = yield* FileSystem.FileSystem;

    const read = (path: string) =>
      fs.readFileString(path).pipe(
        Effect.map((text) => text.trim()),
        Effect.orElseSucceed(() => ""),
      );

    for (const dir of yield* fs.readDirectory(HWMON_DIR)) {
      const base = join(HWMON_DIR, dir);

      if ((yield* read(join(base, "name"))) !== hwmon) continue;

      for (const file of yield* fs.readDirectory(base)) {
        const match = /^(temp\d+)_label$/.exec(file);

        if (match !== null && (yield* read(join(base, file))) === label)
          return join(base, `${match[1]}_input`);
      }
    }

    return yield* new FansError({
      message: `No ${hwmon} temperature labelled ${label} under ${HWMON_DIR}`,
    });
  },
  Effect.mapError((error) =>
    error instanceof FansError
      ? error
      : new FansError({
          message: `Could not read ${HWMON_DIR}: ${error.message}`,
        }),
  ),
);

/** Ramp linearly between the configured speeds, rounded to 5%. */
function speedFor(
  ramp: Ramp,
  speed: FansConfig["speed"],
  temperature: number,
): number {
  if (temperature <= ramp.from) return speed.min;

  if (temperature >= ramp.to) return speed.max;

  const target =
    speed.min +
    ((temperature - ramp.from) * (speed.max - speed.min)) /
      (ramp.to - ramp.from);

  return Math.round(target / 5) * 5;
}

/**
 * Drive the configured liquidctl fan channels from a Home Assistant
 * temperature, falling back to full speed when the reading is unavailable.
 * Reports its own health to `dot services` and hands the hub back to
 * motherboard control when stopped.
 */
export const fansRun = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const config = yield* loadConfig;

  const cpuInput =
    config.cpu === undefined
      ? undefined
      : yield* findHwmonInput(config.cpu.hwmon, config.cpu.label);

  const stop = yield* Deferred.make<void>();
  const appliedSpeed = yield* Ref.make<Option.Option<number>>(Option.none());
  const roomState = yield* Ref.make<Option.Option<RoomState>>(Option.none());
  const cpuReadings = yield* Ref.make<ReadonlyArray<number>>([]);
  const lastLogged = yield* Ref.make("");
  const updateLock = yield* Semaphore.make(1);

  const lastReport = yield* Ref.make<Option.Option<ReportedStatus>>(
    Option.none(),
  );

  const refreshPanel = executor
    .exitCode("omarchy-shell", ["-q", "timmo.services", "refresh"])
    .pipe(Effect.ignore);

  const onSignal = () => Deferred.doneUnsafe(stop, Effect.void);

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
      process.on("SIGHUP", onSignal);
    }),
    () =>
      Effect.sync(() => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        process.off("SIGHUP", onSignal);
      }),
  );

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const restored = yield* executor.exitCode("liquidctl", [
        "--match",
        config.device,
        "initialize",
      ]);

      yield* restored === 0
        ? Console.log("Restored motherboard fan control")
        : Console.error(
            `[ERROR] Could not restore motherboard fan control (liquidctl exit ${restored})`,
          );
      yield* fs.remove(STATUS_FILE, { force: true }).pipe(Effect.ignore);
      yield* refreshPanel;
    }),
  );

  /** `logLine` leaves out the CPU temperature so the journal isn't written every poll. */
  const report = Effect.fn("Fans.report")(function* (
    health: ReportedStatus["health"],
    summary: string,
    logLine: string = summary,
  ) {
    const previous = yield* Ref.get(lastReport);

    const status = {
      health,
      summary,
      updated: yield* Clock.currentTimeMillis,
    } satisfies ReportedStatus;

    yield* writeReportedStatus(STATUS_FILE, status).pipe(
      Effect.catch((error) =>
        Console.error(
          `[WARN] Could not write ${STATUS_FILE}: ${error.message}`,
        ),
      ),
    );
    yield* Ref.set(lastReport, Option.some(status));

    const line = `[${health.toUpperCase()}] ${logLine}`;

    if ((yield* Ref.getAndSet(lastLogged, line)) !== line)
      yield* Console.log(line);

    if (Option.getOrUndefined(previous)?.health !== health) yield* refreshPanel;
  });

  /** Set every channel, returning those liquidctl rejected. */
  const applySpeed = Effect.fn("Fans.applySpeed")(function* (speed: number) {
    if (Option.contains(yield* Ref.get(appliedSpeed), speed)) return [];

    const failed: string[] = [];

    for (const channel of config.channels) {
      const exitCode = yield* executor.exitCode("liquidctl", [
        "--match",
        config.device,
        "set",
        channel,
        "speed",
        String(speed),
      ]);

      if (exitCode !== 0) failed.push(channel);
    }

    yield* Ref.set(
      appliedSpeed,
      failed.length === 0 ? Option.some(speed) : Option.none(),
    );

    return failed;
  });

  /** Apply the higher of the room and CPU speeds, once the room has a state. */
  const update = Effect.gen(function* () {
    const room = yield* Ref.get(roomState);

    if (Option.isNone(room)) return;

    const readings = yield* Ref.get(cpuReadings);

    const cpuTemperature =
      readings.length > 0
        ? readings.reduce((sum, reading) => sum + reading, 0) / readings.length
        : undefined;

    // A configured but unreadable CPU sensor runs the fans at max.
    const cpuTarget =
      config.cpu === undefined
        ? config.speed.min
        : cpuTemperature === undefined
          ? config.speed.max
          : speedFor(config.cpu.ramp, config.speed, cpuTemperature);

    const speed = Math.max(room.value.target, cpuTarget);
    const failed = yield* applySpeed(speed);

    if (failed.length > 0)
      return yield* report(
        room.value.health === "ok" ? "warning" : "failed",
        `${room.value.summary}; could not set ${failed.join(", ")} to ${speed}%`,
      );

    const cpu =
      cpuTemperature === undefined
        ? ""
        : `, CPU ${Math.round(cpuTemperature)} °C`;

    const forCpu =
      config.cpu !== undefined && cpuTarget > room.value.target
        ? " for the CPU"
        : "";

    yield* report(
      room.value.health,
      `${room.value.summary}${cpu}, fans at ${speed}%`,
      `${room.value.summary}, fans at ${speed}%${forCpu}`,
    );
  }).pipe(Semaphore.withPermit(updateLock), Effect.withSpan("Fans.update"));

  const setRoom = Effect.fn("Fans.setRoom")(function* (state: RoomState) {
    yield* Ref.set(roomState, Option.some(state));
    yield* update;
  });

  const control = (temperature: number) =>
    setRoom({
      health: "ok",
      target: speedFor(config.ramp, config.speed, temperature),
      summary: `${temperature} °C`,
    });

  const fallback = (reason: string) =>
    setRoom({
      health: "degraded",
      target: config.speed.max,
      summary: `Fallback ${config.speed.max}%: ${reason}`,
    });

  /** Keep the last room speed while the bridge is away, else go to max. */
  const hold = Effect.fn("Fans.hold")(function* (reason: string) {
    const room = yield* Ref.get(roomState);

    if (Option.isNone(room)) return yield* fallback(reason);

    yield* setRoom({
      health: "degraded",
      target: room.value.target,
      summary: `Holding ${room.value.target}%: ${reason}`,
    });
  });

  if (cpuInput !== undefined)
    yield* fs.readFileString(cpuInput).pipe(
      Effect.flatMap((text) => {
        const temperature = Number(text.trim()) / 1000;

        return text.trim() !== "" && Number.isFinite(temperature)
          ? Ref.update(cpuReadings, (readings) =>
              [...readings, temperature].slice(-CPU_WINDOW),
            )
          : Effect.fail(new FansError({ message: `${cpuInput} is ${text}` }));
      }),
      Effect.catch((error) =>
        Console.error(
          `[WARN] Could not read the CPU temperature: ${error.message}`,
        ).pipe(Effect.andThen(Ref.set(cpuReadings, []))),
      ),
      Effect.andThen(update),
      Effect.catchCause((cause) =>
        Console.error(`[ERROR] ${Cause.pretty(cause)}`),
      ),
      Effect.repeat(Schedule.spaced(CPU_POLL)),
      Effect.forkScoped,
    );

  const watch = Effect.gen(function* () {
    const received = yield* Ref.make(false);

    yield* Effect.sleep(FIRST_READING_TIMEOUT).pipe(
      Effect.andThen(Ref.get(received)),
      Effect.flatMap((seen) =>
        seen ? Effect.void : hold("no reading from Home Assistant"),
      ),
      Effect.forkScoped,
    );

    const exit = yield* Effect.gen(function* () {
      const socketPath = yield* resolveSocketPath(Option.none());

      yield* Effect.gen(function* () {
        const client = yield* BridgeClient;

        yield* client
          .WatchEntities({ target: { entity_id: config.entity } })
          .pipe(
            Stream.runForEach(({ state: { state } }) => {
              const temperature = Number(state);

              return Ref.set(received, true).pipe(
                Effect.andThen(
                  state.trim() !== "" && Number.isFinite(temperature)
                    ? control(temperature)
                    : fallback(`${config.entity} is ${state || "empty"}`),
                ),
              );
            }),
          );
      }).pipe(Effect.provide(BridgeClient.layer(socketPath)));
    }).pipe(Effect.exit);

    if (Exit.isFailure(exit))
      yield* Console.error(`[ERROR] ${Cause.pretty(exit.cause)}`);

    yield* hold(
      Exit.isFailure(exit)
        ? "Home Assistant bridge unavailable"
        : "Home Assistant bridge watch stopped",
    );

    return yield* Ref.get(received);
  }).pipe(Effect.scoped);

  // Reconnect with exponential backoff, resetting once readings flow again.
  const reconnect = Effect.gen(function* () {
    const delay = yield* Ref.make(RETRY_MIN);

    while (true) {
      const connected = yield* watch.pipe(
        Effect.catchCause((cause) =>
          Console.error(`[ERROR] ${Cause.pretty(cause)}`).pipe(
            Effect.as(false),
          ),
        ),
      );

      if (connected) yield* Ref.set(delay, RETRY_MIN);

      const wait = yield* Ref.getAndUpdate(delay, (ms) =>
        Math.min(ms * 2, RETRY_MAX),
      );

      yield* Console.log(
        `Reconnecting to Home Assistant bridge in ${wait / 1000}s`,
      );
      yield* Effect.sleep(Duration.millis(wait));
    }
  });

  yield* Console.log(
    `Controlling ${config.device} ${config.channels.join(", ")} from ${config.entity}${cpuInput === undefined ? "" : ` and ${cpuInput}`}`,
  );

  yield* Effect.raceFirst(reconnect, Deferred.await(stop));
}).pipe(Effect.scoped, Effect.withSpan("Fans.run"));
