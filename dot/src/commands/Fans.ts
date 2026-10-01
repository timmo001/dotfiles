import { join } from "node:path";
import { BridgeClient, resolveSocketPath } from "@timmo001/effect-ha-bridge";
import {
  Clock,
  Console,
  Deferred,
  Effect,
  FileSystem,
  Option,
  Ref,
  Result,
  Schema,
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

const WATCH_RETRY = "15 seconds";

const Percent = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 100 }),
);

const FansConfig = Schema.Struct({
  entity: Schema.String.check(Schema.isPattern(/^\w+\.\w+$/)),
  device: Schema.String,
  channels: Schema.NonEmptyArray(
    Schema.String.check(Schema.isPattern(/^fan\d+$/)),
  ),
  ramp: Schema.Struct({ from: Schema.Finite, to: Schema.Finite }),
  speed: Schema.Struct({ min: Percent, max: Percent }),
});

type FansConfig = typeof FansConfig.Type;

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

  if (config.ramp.from >= config.ramp.to || config.speed.min > config.speed.max)
    return yield* new FansError({
      message: `Invalid ${CONFIG_FILE}: ramp.from must be below ramp.to and speed.min at most speed.max`,
    });

  return config;
}).pipe(Effect.withSpan("Fans.loadConfig"));

/** Ramp linearly between the configured speeds, rounded to 5%. */
function speedFor(config: FansConfig, temperature: number): number {
  const { ramp, speed } = config;

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
  const stop = yield* Deferred.make<void>();
  const appliedSpeed = yield* Ref.make<Option.Option<number>>(Option.none());

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

  const report = Effect.fn("Fans.report")(function* (
    health: ReportedStatus["health"],
    summary: string,
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

    if (Option.getOrUndefined(previous)?.summary !== summary)
      yield* Console.log(`[${health.toUpperCase()}] ${summary}`);

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

  const control = Effect.fn("Fans.control")(function* (temperature: number) {
    const speed = speedFor(config, temperature);
    const failed = yield* applySpeed(speed);

    yield* failed.length > 0
      ? report("warning", `Could not set ${failed.join(", ")} to ${speed}%`)
      : report("ok", `${temperature} °C, fans at ${speed}%`);
  });

  const fallback = Effect.fn("Fans.fallback")(function* (reason: string) {
    const failed = yield* applySpeed(config.speed.max);

    yield* report(
      failed.length > 0 ? "failed" : "degraded",
      failed.length > 0
        ? `${reason}; could not set ${failed.join(", ")} to ${config.speed.max}%`
        : `Fallback ${config.speed.max}%: ${reason}`,
    );
  });

  const watch = Effect.gen(function* () {
    const received = yield* Ref.make(false);

    yield* Effect.sleep(FIRST_READING_TIMEOUT).pipe(
      Effect.andThen(Ref.get(received)),
      Effect.flatMap((seen) =>
        seen ? Effect.void : fallback("no reading from Home Assistant"),
      ),
      Effect.forkScoped,
    );

    const result = yield* Effect.gen(function* () {
      const socketPath = yield* resolveSocketPath(Option.none());

      yield* Effect.gen(function* () {
        const client = yield* BridgeClient;

        yield* client.WatchEntity({ entityId: config.entity }).pipe(
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
    }).pipe(Effect.result);

    if (Result.isFailure(result))
      yield* Console.error(`[ERROR] ${result.failure.message}`);

    yield* fallback(
      Result.isFailure(result)
        ? "Home Assistant bridge watch failed"
        : "Home Assistant bridge watch stopped",
    );
  }).pipe(Effect.scoped);

  yield* Console.log(
    `Controlling ${config.device} ${config.channels.join(", ")} from ${config.entity}`,
  );

  yield* Effect.raceFirst(
    watch.pipe(Effect.andThen(Effect.sleep(WATCH_RETRY)), Effect.forever),
    Deferred.await(stop),
  );
}).pipe(Effect.scoped, Effect.withSpan("Fans.run"));
