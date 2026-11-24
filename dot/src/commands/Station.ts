import { createConnection } from "node:net";
import { join } from "node:path";
import {
  Clock,
  Duration,
  Effect,
  FileSystem,
  Option,
  Schedule,
  Schema,
} from "effect";
import { ENV, envString } from "../lib/env.js";
import { CONFIG_DIR, DOT_BIN, displayPath } from "../lib/paths.js";
import { CommandError, CommandExecutor } from "../services/CommandExecutor.js";

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

/** What Sunshine logs when it starts before Hyprland's Wayland socket; it keeps running but can't stream until it restarts. */
const SUNSHINE_UNUSABLE = "Platform failed to initialize";

/** Sunshine's HTTP port, open once it's ready for Moonlight. */
const SUNSHINE_PORT = 47989;

/** How long Sunshine gets to open its port: its unit waits 5 seconds, then it probes encoders. */
const SUNSHINE_READY_WITHIN = Duration.seconds(20);

/** How often the watcher checks Moonlight, on Station itself. */
const POLL_ON_STATION = Duration.seconds(2);

/** How long the watcher waits before reconnecting; Station's ufw refuses a sixth new SSH connection within 30 seconds. */
const RECONNECT_AFTER = Duration.seconds(10);

/** How long Station can stay unreachable, while this machine is awake, before the watcher takes Moonlight as gone. */
const UNREACHABLE_FOR = Duration.minutes(1);

/** What the watcher's command on Station prints first, so a dropped connection isn't taken for Station being unreachable. */
const CONNECTED = "connected";

/** How many times this machine has suspended since boot. */
const SUSPEND_COUNT = "/sys/power/suspend_stats/success";

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

/** A failure in a line for a notification. */
const failureText = (error: { readonly message: string } | CommandError) =>
  error instanceof CommandError
    ? error.stderr || `${error.command} exited ${error.exitCode}`
    : error.message;

/** Show a desktop notification, since the launcher and keybind have no terminal. */
const notify = Effect.fn("Station.notify")(function* (
  title: string,
  body: string,
) {
  const executor = yield* CommandExecutor;

  yield* executor.exitCode("omarchy", [
    "notification",
    "send",
    "-g",
    "󰍹",
    "--app-name",
    "Display",
    title,
    body,
  ]);
});

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

/** Whether Sunshine accepts connections on its HTTP port. */
const sunshineListening = Effect.callback<boolean>((resume) => {
  const socket = createConnection({ host: "127.0.0.1", port: SUNSHINE_PORT });

  const done = (listening: boolean) => {
    socket.destroy();
    resume(Effect.succeed(listening));
  };

  socket.once("connect", () => done(true));
  socket.once("error", () => done(false));

  return Effect.sync(() => socket.destroy());
});

/**
 * Start Sunshine, or restart it when its current run can't capture the desktop,
 * such as when it started before Hyprland's Wayland socket at login, then wait
 * until it accepts connections.
 */
const ensureSunshine = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const running =
    (yield* executor.exitCode("systemctl", [
      "--user",
      "--quiet",
      "is-active",
      SUNSHINE_UNIT,
    ])) === 0;

  const startedAt = (yield* executor.run("systemctl", [
    "--user",
    "show",
    "--timestamp=unix",
    "--property=ExecMainStartTimestamp",
    "--value",
    SUNSHINE_UNIT,
  ])).trim();

  // journalctl exits 1 when --grep matches nothing since this run started.
  const unusable =
    running &&
    startedAt !== "" &&
    (yield* executor.exitCode("journalctl", [
      "--user",
      "--quiet",
      `--unit=${SUNSHINE_UNIT}`,
      `--since=${startedAt}`,
      `--grep=${SUNSHINE_UNUSABLE}`,
    ])) === 0;

  if (unusable)
    yield* executor.run("systemctl", ["--user", "restart", SUNSHINE_UNIT]);
  else if (!running)
    yield* executor.run("systemctl", ["--user", "start", SUNSHINE_UNIT]);

  const ready = yield* sunshineListening.pipe(
    Effect.repeat({
      until: (listening) => listening,
      schedule: Schedule.spaced(Duration.millis(500)),
    }),
    Effect.timeoutOption(SUNSHINE_READY_WITHIN),
  );

  if (Option.isNone(ready))
    return yield* new StationError({
      message: `Sunshine didn't open port ${SUNSHINE_PORT} within ${Duration.toSeconds(SUNSHINE_READY_WITHIN)} seconds.`,
    });
}).pipe(Effect.withSpan("Station.ensureSunshine"));

/** Add the Station desktop and show it on Station's TV through dot screen moonlight there. */
export const stationDesktopOn = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  // Before STATION exists: Sunshine's saved screen-share permission only
  // covers the outputs it was given for, so starting with STATION present
  // leaves it waiting on the portal.
  yield* ensureSunshine;

  if (Option.isNone(yield* stationOutput))
    yield* executor.run("hyprctl", ["output", "create", "headless", OUTPUT]);

  const output = yield* stationOutput;

  if (Option.isNone(output))
    return yield* new StationError({
      message: `Hyprland didn't add ${OUTPUT}.`,
    });

  const { width, height } = output.value;
  const fps = Math.round(output.value.refreshRate);
  const status = yield* moonlightStatus;

  if (status === SSH_FAILED) {
    yield* removeOutput;

    return yield* new StationError({
      message: "Couldn't reach Station, so STATION is off again.",
    });
  }

  if (status === 0) {
    yield* startWatch;
    yield* say("Moonlight is already showing it on Station.");
    yield* notify(
      "Station desktop on",
      "Moonlight is already showing it on Station.",
    );

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
  ]).pipe(Effect.tapError(() => removeOutput));
  yield* startWatch;

  const shown = `Station is showing ${OUTPUT} (${width}x${height}@${fps}).`;

  yield* say(shown);
  yield* notify("Station desktop on", shown);
}).pipe(
  Effect.tapError((error) =>
    notify("Station desktop didn't turn on", failureText(error)),
  ),
  Effect.withSpan("Station.on"),
);

/** Close Moonlight on Station, which puts back what its TV showed before, and remove the Station desktop. */
export const stationDesktopOff = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  yield* executor.exitCode("systemctl", ["--user", "stop", WATCH_UNIT]);

  const status = yield* moonlightStatus;

  // dot screen last switches away from anything, so only while it's Moonlight.
  if (status === 0)
    yield* executor.exitCode(
      "ssh",
      yield* sshArgs([STATION_DOT, "screen", "last"]),
    );

  yield* removeOutput;
  yield* say(`${OUTPUT} is off.`);
  yield* notify(
    "Station desktop off",
    status === SSH_FAILED
      ? "Couldn't reach Station, so its TV may still show Moonlight. Its windows are back here."
      : "Its windows are back here.",
  );
}).pipe(
  Effect.tapError((error) =>
    notify("Station desktop didn't turn off", failureText(error)),
  ),
  Effect.withSpan("Station.off"),
);

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

/** How many times this machine has suspended since boot, or 0 when the kernel doesn't say. */
const suspendCount = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFileString(SUSPEND_COUNT).pipe(
    Effect.map((text) => Number(text.trim()) || 0),
    Effect.orElseSucceed(() => 0),
  );
}).pipe(Effect.withSpan("Station.suspendCount"));

/** How one watcher connection ended. */
type Attempt = "closed" | "dropped" | "unreachable";

/** When Station became unreachable, and how many times this machine had suspended by then. */
interface Outage {
  readonly since: number;
  readonly suspends: number;
}

/**
 * Remove the Station desktop once Moonlight on Station stops, such as when it's
 * closed there or another dot screen command takes the TV, or once Station has
 * been unreachable for a minute while this machine was awake, such as when it
 * reboots or shuts down. One SSH connection waits on Station, since Station
 * rate limits new ones; when it drops, it reconnects every 10 seconds, and a
 * suspend here starts the minute again, since the drop is then this machine's.
 */
export const stationDesktopWatch = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const args = yield* sshArgs([
    `echo ${CONNECTED}; while ${STATION_DOT} screen status | grep -q '${MOONLIGHT_ON_SCREEN}'; do sleep ${Duration.toSeconds(POLL_ON_STATION)}; done`,
  ]);

  const waitForMoonlight = executor
    .run("ssh", [
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      ...args,
    ])
    .pipe(
      Effect.map((): Attempt => "closed"),
      Effect.catchTag("CommandError", (error) =>
        Effect.succeed<Attempt>(
          error.exitCode !== SSH_FAILED
            ? "closed"
            : error.stdout?.includes(CONNECTED)
              ? "dropped"
              : "unreachable",
        ),
      ),
    );

  const watchFrom = (
    outage: Option.Option<Outage>,
  ): Effect.Effect<"closed" | "unreachable", never, FileSystem.FileSystem> =>
    Effect.gen(function* () {
      const attempt = yield* waitForMoonlight;

      if (attempt === "closed") return "closed";

      const now = yield* Clock.currentTimeMillis;
      const suspends = yield* suspendCount;

      const ongoing =
        attempt === "unreachable"
          ? Option.filter(outage, (last) => last.suspends === suspends)
          : Option.none<Outage>();

      if (
        Option.isSome(ongoing) &&
        now - ongoing.value.since >= Duration.toMillis(UNREACHABLE_FOR)
      )
        return "unreachable";

      yield* Effect.sleep(RECONNECT_AFTER);

      return yield* watchFrom(
        Option.isSome(ongoing)
          ? ongoing
          : Option.some({ since: now, suspends }),
      );
    });

  const end = yield* watchFrom(Option.none());

  if (Option.isSome(yield* stationOutput)) {
    yield* removeOutput;
    yield* notify(
      "Station desktop off",
      end === "closed"
        ? "Moonlight on Station closed, so its windows are back here."
        : "Station has been unreachable for a minute, so its windows are back here.",
    );
  }
}).pipe(Effect.withSpan("Station.watch"));
