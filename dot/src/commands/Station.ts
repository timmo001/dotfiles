import { join } from "node:path";
import { Duration, Effect, FileSystem, Option, Schedule, Schema } from "effect";
import { ENV, envString } from "../lib/env.js";
import { CONFIG_DIR, DOT_BIN, displayPath } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** Where Station's SSH destination is configured, stowed from the private overlay. */
const CONFIG_PATH = join(CONFIG_DIR, "dot", "station-screen.yml");

const StationConfig = Schema.Struct({
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

/** The transient user unit here that removes the desktop once Moonlight closes. */
const WATCH_UNIT = "station-desktop-watch";

const SUNSHINE_UNIT = "app-dev.lizardbyte.app.Sunshine.service";

/** How often the watcher checks Moonlight, on Station itself. */
const POLL_ON_STATION = Duration.seconds(2);

/** How long the watcher waits before reconnecting; Station's ufw refuses a sixth new SSH connection within 30 seconds. */
const RECONNECT_AFTER = Duration.seconds(30);

/** Station couldn't do what was asked, or couldn't be reached. */
export class StationError extends Schema.TaggedError<StationError>()(
  "StationError",
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

/** The Station desktop's output, when it's on. */
const stationOutput = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const monitors = yield* executor
    .run("hyprctl", ["-j", "monitors"])
    .pipe(Effect.flatMap(decodeMonitors));

  return Option.fromNullishOr(
    monitors.find((monitor) => monitor.name === OUTPUT),
  );
}).pipe(Effect.withSpan("Station.output"));

const removeOutput = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  if (Option.isSome(yield* stationOutput))
    yield* executor.run("hyprctl", ["output", "remove", OUTPUT]);
}).pipe(Effect.withSpan("Station.removeOutput"));

/** ssh arguments to run `args` on Station, with its destination from the private config. */
const sshArgs = Effect.fn("Station.sshArgs")(function* (
  args: readonly string[],
) {
  const fs = yield* FileSystem.FileSystem;

  const config = yield* fs.readFileString(CONFIG_PATH).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(Schema.decodeUnknownEffect(StationConfig)),
    Effect.mapError(
      (cause) =>
        new StationError({
          message: `read ${displayPath(CONFIG_PATH)}: ${cause.message}`,
        }),
    ),
  );

  return ["-o", "ConnectTimeout=5", ...SSH_CONTROL, config.ssh, ...args];
});

/** Run dot on Station, failing when it fails. */
const stationDot = Effect.fn("Station.stationDot")(function* (
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
}).pipe(Effect.withSpan("Station.moonlightStatus"));

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
      "desktop",
      "watch",
    ]);
}).pipe(Effect.withSpan("Station.startWatch"));

/** Add the Station desktop and show it on Station's TV through dot screen moonlight there. */
export const stationDesktopOn = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  yield* executor.run("systemctl", ["--user", "start", SUNSHINE_UNIT]);

  if (Option.isNone(yield* stationOutput))
    yield* executor.run("hyprctl", ["output", "create", "headless", OUTPUT]);

  const output = yield* stationOutput;

  if (Option.isNone(output))
    return yield* new StationError({
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
}).pipe(Effect.withSpan("Station.on"));

/** Close Moonlight on Station, which puts back what its TV showed before, and remove the Station desktop. */
export const stationDesktopOff = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  yield* executor.exitCode("systemctl", ["--user", "stop", WATCH_UNIT]);

  // dot screen last switches away from anything, so only while it's Moonlight.
  if ((yield* moonlightStatus) === 0)
    yield* executor.exitCode(
      "ssh",
      yield* sshArgs([STATION_DOT, "screen", "last"]),
    );

  yield* removeOutput;
  yield* say(`${OUTPUT} is off.`);
}).pipe(Effect.withSpan("Station.off"));

/** Turn the Station desktop off when it's on, otherwise on. */
export const stationDesktopToggle = Effect.gen(function* () {
  if (Option.isSome(yield* stationOutput)) return yield* stationDesktopOff;

  return yield* stationDesktopOn;
}).pipe(Effect.withSpan("Station.toggle"));

/** Say whether the Station desktop is on and Moonlight is showing it. */
export const stationDesktopStatus = Effect.gen(function* () {
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
}).pipe(Effect.withSpan("Station.status"));

/** Run one of Station's own dot screen commands, which switch what its TV shows. */
export const stationScreen = Effect.fn("Station.screen")(function* (
  args: readonly string[],
) {
  const executor = yield* CommandExecutor;

  const exitCode = yield* executor.inherit(
    "ssh",
    yield* sshArgs([STATION_DOT, "screen", ...args]),
  );

  if (exitCode !== 0)
    return yield* new StationError({
      message: `dot screen ${args.join(" ")} on Station exited ${exitCode}`,
    });
});

/**
 * Remove the Station desktop once Moonlight on Station stops, such as when it's
 * closed there or another dot screen command takes the TV. One SSH connection
 * waits on Station, since Station rate limits new ones; when it drops, as
 * while this machine sleeps, it reconnects rather than taking that as
 * Moonlight closing.
 */
export const stationDesktopWatch = Effect.gen(function* () {
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
      "Station desktop off",
      "Moonlight on Station closed, so its windows are back here.",
    ]);
  }
}).pipe(Effect.withSpan("Station.watch"));
