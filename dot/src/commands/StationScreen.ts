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

/** Present while Station's HDR is off for the Station screen and should come back on. */
const HDR_RESTORE = join(RUNTIME_DIR, "dot-station-screen-hdr");

/** The headless Hyprland output, which Sunshine streams (output_name in sunshine.conf). */
const OUTPUT = "STATION";

/** Moonlight's transient user unit on Station. */
const MOONLIGHT_UNIT = "station-screen-moonlight";

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

/**
 * Switch Station's desktop to SDR while it shows the Station screen, which is
 * an SDR stream, noting that it was in HDR so it can go back afterwards.
 */
const pauseHdr = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const status = yield* stationDot(["screen", "status"]);

  if (!/^HDR: on$/m.test(status)) return;

  yield* fs.writeFileString(HDR_RESTORE, "on\n");
  yield* stationDot(["hdr", "off"]);
  yield* say("Switched Station's desktop to SDR while it shows this screen.");
}).pipe(Effect.withSpan("StationScreen.pauseHdr"));

/** Turn Station's HDR back on, when the Station screen switched it off. */
const restoreHdr = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;

  if (!(yield* fs.exists(HDR_RESTORE).pipe(Effect.orElseSucceed(() => false))))
    return;

  yield* fs.remove(HDR_RESTORE, { force: true });

  // Fails when the desktop has gone, such as for gaming mode, and Plasma turns
  // HDR on at its next login anyway.
  const exitCode = yield* executor.exitCode(
    "ssh",
    yield* sshArgs([STATION_DOT, "hdr", "on"]),
  );

  if (exitCode === 0) yield* say("Switched Station's desktop back to HDR.");
}).pipe(Effect.withSpan("StationScreen.restoreHdr"));

/** systemctl is-active's status for Moonlight on Station, or 255 when Station can't be reached. */
const moonlightStatus = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  return yield* executor.exitCode(
    "ssh",
    yield* sshArgs([
      "systemctl",
      "--user",
      "--quiet",
      "is-active",
      MOONLIGHT_UNIT,
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

/** Add the Station screen and open Moonlight on Station to show it. */
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

  yield* pauseHdr.pipe(
    Effect.catch((error) =>
      Effect.sync(() =>
        process.stderr.write(
          `[WARN] Could not switch Station's desktop to SDR: ${error.message}\n`,
        ),
      ),
    ),
  );

  yield* executor.run(
    "ssh",
    yield* sshArgs([
      "systemd-run",
      "--user",
      "--collect",
      "--quiet",
      `--unit=${MOONLIGHT_UNIT}`,
      "moonlight",
      "stream",
      `${host}.local`,
      "Desktop",
      "--resolution",
      `${width}x${height}`,
      "--fps",
      String(fps),
      "--display-mode",
      "fullscreen",
      "--audio-on-host",
    ]),
  );
  yield* startWatch;
  yield* say(`Station is showing ${OUTPUT} (${width}x${height}@${fps}).`);
}).pipe(Effect.withSpan("StationScreen.on"));

/** Close Moonlight on Station and remove the Station screen. */
export const stationScreenOff = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  yield* executor.exitCode("systemctl", ["--user", "stop", WATCH_UNIT]);
  yield* executor.exitCode(
    "ssh",
    yield* sshArgs(["systemctl", "--user", "stop", MOONLIGHT_UNIT]),
  );
  yield* removeOutput;
  yield* say(`${OUTPUT} is off.`);
  yield* restoreHdr;
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

/** Switch HDR on Station's screens through its own dot hdr. */
export const stationHdr = Effect.fn("StationScreen.hdr")(function* (
  state: "on" | "off",
) {
  const executor = yield* CommandExecutor;

  const exitCode = yield* executor.inherit(
    "ssh",
    yield* sshArgs([STATION_DOT, "hdr", state]),
  );

  if (exitCode !== 0)
    return yield* new StationScreenError({
      message: `dot hdr ${state} on Station exited ${exitCode}`,
    });
});

/**
 * Remove the Station screen once Moonlight on Station stops, such as when dot
 * screen ends the session it runs in. One SSH connection waits on Station,
 * since Station rate limits new ones; when it drops, as while this machine
 * sleeps, it reconnects rather than taking that as Moonlight closing.
 */
export const stationScreenWatch = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const waitForMoonlight = sshArgs([
    `while systemctl --user --quiet is-active ${MOONLIGHT_UNIT}; do sleep ${Duration.toSeconds(POLL_ON_STATION)}; done`,
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

  yield* restoreHdr;
}).pipe(Effect.withSpan("StationScreen.watch"));
