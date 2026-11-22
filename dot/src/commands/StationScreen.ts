import { join } from "node:path";
import { Duration, Effect, FileSystem, Option, Schedule, Schema } from "effect";
import { ENV, envString } from "../lib/env.js";
import { CONFIG_DIR, DOT_BIN, displayPath } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** Where Station's SSH destination is configured, stowed from the private overlay. */
const CONFIG_PATH = join(CONFIG_DIR, "dot", "station-screen.yml");

const StationScreenConfig = Schema.Struct({
  /** SSH destination, such as `user@host`. */
  ssh: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_][\w.@-]*$/)),
});

/** This session's runtime directory, which ends with it. */
const RUNTIME_DIR =
  envString(ENV.XDG_RUNTIME_DIR) ?? `/run/user/${process.getuid?.() ?? 1000}`;

/**
 * Shared SSH connection to Station: Station's ufw refuses a sixth new SSH
 * connection within 30 seconds, and on and off make several calls each.
 */
const SSH_CONTROL = [
  "-o",
  "ControlMaster=auto",
  "-o",
  `ControlPath=${join(RUNTIME_DIR, "dot-station-ssh-%C")}`,
  "-o",
  "ControlPersist=60",
];

/** dot on Station; a plain SSH shell doesn't have ~/.local/bin on its PATH. */
const STATION_DOT = "~/.local/bin/dot";

/** The headless Hyprland output, which Sunshine streams (output_name in sunshine.conf). */
const OUTPUT = "STATION";

/** Station's dot screen status while its TV shows a Moonlight stream. */
const MOONLIGHT_ON_SCREEN = "^On screen: Moonlight";

/** The transient user unit here that removes the screen once Moonlight closes. */
const WATCH_UNIT = "station-screen-watch";

const SUNSHINE_UNIT = "app-dev.lizardbyte.app.Sunshine.service";

/** How often the watcher checks Moonlight, on Station itself. */
const POLL_ON_STATION = Duration.seconds(2);

/** How long the watcher waits before reconnecting; Station's ufw refuses a sixth new SSH connection within 30 seconds. */
const RECONNECT_AFTER = Duration.seconds(30);

/** The Station screen could not be added. */
export class StationScreenError extends Schema.TaggedError<StationScreenError>()(
  "StationScreenError",
  { message: Schema.String },
) {}

/** ssh's own exit status when it can't reach Station. */
const SSH_FAILED = 255;

const MonitorSchema = Schema.Struct({
  name: Schema.String,
  width: Schema.Finite,
  height: Schema.Finite,
  refreshRate: Schema.Finite,
  activeWorkspace: Schema.Struct({ name: Schema.String }),
});

const decodeMonitors = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(MonitorSchema)),
);

const say = (line: string) =>
  Effect.sync(() => process.stdout.write(`${line}\n`));

/** The Station screen, when it's on. */
const stationOutput = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const monitors = yield* executor
    .run("hyprctl", ["-j", "monitors"])
    .pipe(Effect.flatMap(decodeMonitors));

  return Option.fromNullishOr(
    monitors.find((monitor) => monitor.name === OUTPUT),
  );
}).pipe(Effect.withSpan("StationScreen.output"));

const removeOutput = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  if (Option.isSome(yield* stationOutput))
    yield* executor.run("hyprctl", ["output", "remove", OUTPUT]);
}).pipe(Effect.withSpan("StationScreen.removeOutput"));

/** ssh arguments to run `args` on Station, with its destination from the private config. */
const sshArgs = Effect.fn("StationScreen.sshArgs")(function* (
  args: readonly string[],
) {
  const fs = yield* FileSystem.FileSystem;

  const config = yield* fs.readFileString(CONFIG_PATH).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(StationScreenConfig)),
    Effect.mapError(
      (cause) =>
        new StationScreenError({
          message: `read ${displayPath(CONFIG_PATH)}: ${cause.message}`,
        }),
    ),
  );

  return ["-o", "ConnectTimeout=5", ...SSH_CONTROL, config.ssh, ...args];
});

/** Run dot on Station, failing when it fails. */
const stationDot = Effect.fn("StationScreen.stationDot")(function* (
  args: readonly string[],
) {
  const executor = yield* CommandExecutor;

  return yield* executor.run("ssh", yield* sshArgs([STATION_DOT, ...args]));
});

/** Whether Station's TV shows Moonlight: 0 when it does, 255 when Station can't be reached. */
const moonlightStatus = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  return yield* executor.exitCode(
    "ssh",
    yield* sshArgs([
      `${STATION_DOT} screen status | grep -q '${MOONLIGHT_ON_SCREEN}'`,
    ]),
  );
}).pipe(Effect.withSpan("StationScreen.moonlightStatus"));

const startWatch = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const watching = yield* executor.exitCode("systemctl", [
    "--user",
    "--quiet",
    "is-active",
    WATCH_UNIT,
  ]);

  if (watching !== 0)
    yield* executor.run("systemd-run", [
      "--user",
      "--collect",
      "--quiet",
      `--unit=${WATCH_UNIT}`,
      DOT_BIN,
      "station",
      "screen",
      "watch",
    ]);
}).pipe(Effect.withSpan("StationScreen.startWatch"));

/** Add the Station screen and show it on Station's TV through dot screen moonlight there. */
export const stationScreenOn = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  yield* executor.run("systemctl", ["--user", "start", SUNSHINE_UNIT]);

  if (Option.isNone(yield* stationOutput))
    yield* executor.run("hyprctl", ["output", "create", "headless", OUTPUT]);

  const output = yield* stationOutput;

  if (Option.isNone(output))
    return yield* new StationScreenError({
      message: `Hyprland didn't add ${OUTPUT}.`,
    });

  const { width, height } = output.value;
  const fps = Math.round(output.value.refreshRate);

  if ((yield* moonlightStatus) === 0) {
    yield* startWatch;
    yield* say("Moonlight is already showing it on Station.");

    return;
  }

  const host = (yield* executor.run("hostnamectl", ["hostname"])).trim();

  yield* stationDot([
    "screen",
    "moonlight",
    `${host}.local`,
    "--width",
    String(width),
    "--height",
    String(height),
    "--fps",
    String(fps),
  ]);
  yield* startWatch;
  yield* say(`Station is showing ${OUTPUT} (${width}x${height}@${fps}).`);
}).pipe(Effect.withSpan("StationScreen.on"));

/** Close Moonlight on Station, which puts back what its TV showed before, and remove the Station screen. */
export const stationScreenOff = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  yield* executor.exitCode("systemctl", ["--user", "stop", WATCH_UNIT]);
  yield* executor.exitCode(
    "ssh",
    yield* sshArgs([STATION_DOT, "screen", "back"]),
  );
  yield* removeOutput;
  yield* say(`${OUTPUT} is off.`);
}).pipe(Effect.withSpan("StationScreen.off"));

/** Turn the Station screen off when it's on, otherwise on. */
export const stationScreenToggle = Effect.gen(function* () {
  if (Option.isSome(yield* stationOutput)) return yield* stationScreenOff;

  return yield* stationScreenOn;
}).pipe(Effect.withSpan("StationScreen.toggle"));

/** Say whether the Station screen is on and Moonlight is showing it. */
export const stationScreenStatus = Effect.gen(function* () {
  const output = yield* stationOutput;

  yield* say(
    Option.match(output, {
      onNone: () => `${OUTPUT}: off`,
      onSome: (monitor) =>
        `${OUTPUT}: ${monitor.width}x${monitor.height}@${Math.round(monitor.refreshRate)}, workspace ${monitor.activeWorkspace.name}`,
    }),
  );

  const status = yield* moonlightStatus;

  yield* say(
    `Moonlight on Station: ${status === 0 ? "active" : status === SSH_FAILED ? "unreachable" : "inactive"}`,
  );
}).pipe(Effect.withSpan("StationScreen.status"));

/** Run one of Station's own dot screen commands, which switch what its TV shows. */
export const stationTv = Effect.fn("StationScreen.tv")(function* (
  args: readonly string[],
) {
  const executor = yield* CommandExecutor;

  const exitCode = yield* executor.inherit(
    "ssh",
    yield* sshArgs([STATION_DOT, "screen", ...args]),
  );

  if (exitCode !== 0)
    return yield* new StationScreenError({
      message: `dot screen ${args.join(" ")} on Station exited ${exitCode}`,
    });
});

/**
 * Remove the Station screen once Moonlight on Station stops, such as when it's
 * closed there or another dot screen command takes the TV. One SSH connection
 * waits on Station, since Station rate limits new ones; when it drops, as
 * while this machine sleeps, it reconnects rather than taking that as
 * Moonlight closing.
 */
export const stationScreenWatch = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const waitForMoonlight = sshArgs([
    `while ${STATION_DOT} screen status | grep -q '${MOONLIGHT_ON_SCREEN}'; do sleep ${Duration.toSeconds(POLL_ON_STATION)}; done`,
  ]).pipe(
    Effect.flatMap((args) =>
      executor.exitCode("ssh", [
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        ...args,
      ]),
    ),
  );

  yield* waitForMoonlight.pipe(
    Effect.repeat({
      while: (status) => status === SSH_FAILED,
      schedule: Schedule.spaced(RECONNECT_AFTER),
    }),
  );

  if (Option.isSome(yield* stationOutput)) {
    yield* removeOutput;
    yield* executor.exitCode("omarchy", [
      "notification",
      "send",
      "-g",
      "󰍹",
      "--app-name",
      "Display",
      "Station screen off",
      "Moonlight on Station closed, so its windows are back here.",
    ]);
  }
}).pipe(Effect.withSpan("StationScreen.watch"));
