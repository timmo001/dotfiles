import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { Duration, Effect, FileSystem, Option, Schedule, Schema } from "effect";
import { ENV, envString } from "../lib/env.js";
import { currentOmarchyHost } from "../lib/omarchyHost.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** This session's runtime directory, where the bus and Wayland sockets go. */
const RUNTIME_DIR =
  envString(ENV.XDG_RUNTIME_DIR) ?? `/run/user/${process.getuid?.() ?? 1000}`;

/**
 * The virtual screen's own session bus. KWin claims org.kde.KWin on its bus,
 * so on the shared one it would clash with Plasma whenever the TV shows it.
 */
const BUS_SOCKET = join(RUNTIME_DIR, "agent-browser-bus");

const BUS_ADDRESS = `unix:path=${BUS_SOCKET}`;

/** The virtual screen's Wayland socket, in the runtime directory. */
const WAYLAND_SOCKET = "wayland-agent";

/** KWin's name for its virtual output. */
const OUTPUT = "Virtual-0";

const WIDTH = 2560;
const HEIGHT = 1440;

const BUS_UNIT = "agent-browser-bus";
const KWIN_UNIT = "agent-browser-kwin";
const CHROMIUM_UNIT = "agent-browser-chromium";

/** Stopped in this order: Chromium before the screen it's on, the screen before its bus. */
const UNITS = [CHROMIUM_UNIT, KWIN_UNIT, BUS_UNIT] as const;

/** Chromium's own profile, and the browse extension unpacked with its Web Store key. */
const BROWSER_DIR = join(homedir(), ".local", "share", "station-browser");
const PROFILE_DIR = join(BROWSER_DIR, "profile");
const EXTENSION_DIR = join(BROWSER_DIR, "extension");

/** Not on PATH: Qt installs its QML runner here. */
const QML_RUNNER = "/usr/lib/qt6/bin/qml";

/**
 * Chromium's DevTools port, on localhost only, so a capture can bring a browse
 * tab to the front.
 */
const DEVTOOLS_PORT = 9223;

/** How long each piece gets to come up. */
const READY_WITHIN = Duration.seconds(30);

/** How long a recording gets to start, and to finish writing after it stops. */
const RECORD_SLACK = Duration.seconds(30);

const MAX_RECORD_SECONDS = 600;

/**
 * Records the virtual screen as H.264: Plasma's ScreencastingRequest asks KWin
 * for a PipeWire stream of the output, and kpipewire's PipeWireRecord encodes
 * it. Arguments: output file, seconds. Spectacle's own recording needs a
 * person to stop it, so it can't record here.
 */
const RECORD_QML = `import QtQuick
import org.kde.taskmanager as TaskManager
import org.kde.pipewire.record as PWRec

QtObject {
    id: root

    property var args: Qt.application.arguments
    property string outputFile: args[args.length - 2]
    property int seconds: parseInt(args[args.length - 1])
    property bool stopping: false

    property var cast: TaskManager.ScreencastingRequest {
        outputName: "${OUTPUT}"
        onNodeIdChanged: {
            root.rec.nodeId = nodeId
            root.rec.start()
            root.length.start()
        }
    }

    property var rec: PWRec.PipeWireRecord {
        output: root.outputFile
        encoder: PWRec.PipeWireRecord.H264Main
        onStateChanged: {
            if (root.stopping && state === PWRec.PipeWireRecord.Idle)
                Qt.quit()
        }
        onErrorFound: error => {
            console.error(error)
            Qt.exit(1)
        }
    }

    property var length: Timer {
        interval: root.seconds * 1000
        onTriggered: {
            root.stopping = true
            root.rec.stop()
        }
    }

    property var startup: Timer {
        interval: 10000
        running: true
        onTriggered: {
            if (root.cast.nodeId === 0) {
                console.error("KWin didn't share the screen")
                Qt.exit(1)
            }
        }
    }
}
`;

/** The agent browser can't do what was asked. */
export class AgentBrowserError extends Schema.TaggedError<AgentBrowserError>()(
  "AgentBrowserError",
  { message: Schema.String },
) {}

const BrowseStatus = Schema.Struct({
  extension: Schema.Struct({
    browsers: Schema.Array(
      Schema.Struct({ id: Schema.String, connected: Schema.Boolean }),
    ),
  }),
  tabs: Schema.Array(
    Schema.Struct({
      tab: Schema.Number,
      /** The id an agent chose for the tab, such as `work-mail`. */
      id: Schema.optionalKey(Schema.String),
      targetId: Schema.String,
    }),
  ),
});

const decodeBrowseStatus = Schema.decodeEffect(
  Schema.fromJsonString(BrowseStatus),
);

/** What reaches the virtual screen and its bus. */
const SCREEN_ENV = {
  WAYLAND_DISPLAY: WAYLAND_SOCKET,
  DBUS_SESSION_BUS_ADDRESS: BUS_ADDRESS,
  QT_QPA_PLATFORM: "wayland",
};

const say = (line: string) =>
  Effect.sync(() => process.stdout.write(`${line}\n`));

const requireStation = Effect.suspend(() =>
  currentOmarchyHost() === "station"
    ? Effect.void
    : Effect.fail(
        new AgentBrowserError({
          message:
            "dot agent browser runs on Station. Elsewhere, browse uses your own browser, and dot agent screen keeps its windows off-screen.",
        }),
      ),
);

const unitActive = Effect.fn("AgentBrowser.unitActive")(function* (
  unit: string,
) {
  const executor = yield* CommandExecutor;

  return (
    (yield* executor.exitCode("systemctl", [
      "--user",
      "--quiet",
      "is-active",
      unit,
    ])) === 0
  );
});

/** Start a command as a transient user unit, with its environment and the unit it needs. */
const startUnit = Effect.fn("AgentBrowser.startUnit")(function* (
  unit: string,
  env: Readonly<Record<string, string>>,
  command: readonly string[],
  bindsTo?: string,
) {
  const executor = yield* CommandExecutor;

  yield* executor.run("systemd-run", [
    "--user",
    "--collect",
    "--quiet",
    `--unit=${unit}`,
    ...(bindsTo
      ? [
          `--property=BindsTo=${bindsTo}.service`,
          `--property=After=${bindsTo}.service`,
        ]
      : []),
    ...Object.entries(env).map(([name, value]) => `--setenv=${name}=${value}`),
    ...command,
  ]);
});

/** Wait until `ready` holds, failing with `what` once it's taken too long. */
const waitUntil = Effect.fn("AgentBrowser.waitUntil")(function* <E, R>(
  ready: Effect.Effect<boolean, E, R>,
  what: string,
) {
  const done = yield* ready.pipe(
    Effect.repeat({
      until: (ok) => ok,
      schedule: Schedule.spaced(Duration.millis(250)),
    }),
    Effect.timeoutOption(READY_WITHIN),
  );

  if (Option.isNone(done))
    return yield* new AgentBrowserError({
      message: `${what} within ${Duration.toSeconds(READY_WITHIN)} seconds.`,
    });
});

const socketExists = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
  });

/** The browse browsers that are connected, or none when browse can't say. */
const browseConnected = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  return yield* executor.run("browse", ["status", "--json"]).pipe(
    Effect.flatMap(decodeBrowseStatus),
    Effect.map((status) =>
      status.extension.browsers
        .filter((browser) => browser.connected)
        .map((browser) => browser.id),
    ),
    Effect.orElseSucceed((): string[] => []),
  );
}).pipe(Effect.withSpan("AgentBrowser.browseConnected"));

/**
 * Bring a browse tab to the front, so whole-screen captures show it. browse
 * opens its tabs in the background and won't focus them, so this goes through
 * Chromium's DevTools port instead, by the tab's target id.
 */
const bringToFront = Effect.fn("AgentBrowser.bringToFront")(function* (
  tab: string,
) {
  const executor = yield* CommandExecutor;

  const status = yield* executor
    .run("browse", ["status", "--json"])
    .pipe(Effect.flatMap(decodeBrowseStatus));

  const target = status.tabs.find(
    (entry) => String(entry.tab) === tab || entry.id === tab,
  );

  if (!target)
    return yield* new AgentBrowserError({
      message: `browse has no tab ${tab}: browse status lists the open ones.`,
    });

  yield* executor.run("curl", [
    "--silent",
    "--fail",
    `http://127.0.0.1:${DEVTOOLS_PORT}/json/activate/${target.targetId}`,
  ]);
});

const requireScreen = Effect.gen(function* () {
  yield* requireStation;

  if (!(yield* unitActive(KWIN_UNIT)))
    return yield* new AgentBrowserError({
      message: "The virtual screen is off: start it with dot agent browser on.",
    });
}).pipe(Effect.withSpan("AgentBrowser.requireScreen"));

/** Start the virtual screen and Chromium on it, and wait for browse to connect. */
export const agentBrowserOn = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  yield* requireStation;

  if (!(yield* socketExists(join(EXTENSION_DIR, "manifest.json"))))
    return yield* new AgentBrowserError({
      message: `The browse extension isn't unpacked in ${EXTENSION_DIR}.`,
    });

  if (!(yield* unitActive(BUS_UNIT))) {
    yield* startUnit(BUS_UNIT, {}, [
      "dbus-daemon",
      "--session",
      "--nofork",
      "--nopidfile",
      `--address=${BUS_ADDRESS}`,
    ]);
    yield* waitUntil(
      socketExists(BUS_SOCKET),
      "The virtual screen's bus didn't start",
    );
  }

  if (!(yield* unitActive(KWIN_UNIT))) {
    // The user manager can carry the Plasma session's display.
    yield* startUnit(
      KWIN_UNIT,
      { DBUS_SESSION_BUS_ADDRESS: BUS_ADDRESS },
      [
        "env",
        "-u",
        "WAYLAND_DISPLAY",
        "-u",
        "DISPLAY",
        "kwin_wayland",
        "--virtual",
        "--socket",
        WAYLAND_SOCKET,
        "--width",
        String(WIDTH),
        "--height",
        String(HEIGHT),
        "--scale",
        "1",
        "--no-lockscreen",
        "--no-global-shortcuts",
        "--no-kactivities",
      ],
      BUS_UNIT,
    );
    yield* waitUntil(
      socketExists(join(RUNTIME_DIR, WAYLAND_SOCKET)),
      "KWin didn't start the virtual screen",
    );
    // KWin keeps the scale it saved for the output over --scale, and picks
    // 2.5x for a new one, which would shrink pages to 1024 wide.
    yield* executor.run("kscreen-doctor", [`output.${OUTPUT}.scale.1`], {
      env: SCREEN_ENV,
    });
  }

  if (!(yield* unitActive(CHROMIUM_UNIT)))
    yield* startUnit(
      CHROMIUM_UNIT,
      {
        WAYLAND_DISPLAY: WAYLAND_SOCKET,
        DBUS_SESSION_BUS_ADDRESS: BUS_ADDRESS,
      },
      [
        "chromium",
        "--ozone-platform=wayland",
        `--user-data-dir=${PROFILE_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
        "--start-maximized",
        "--remote-debugging-address=127.0.0.1",
        `--remote-debugging-port=${DEVTOOLS_PORT}`,
      ],
      KWIN_UNIT,
    );

  yield* waitUntil(
    browseConnected.pipe(Effect.map((browsers) => browsers.length > 0)),
    "Chromium is running, but browse's extension didn't connect",
  );

  const browsers = yield* browseConnected;

  yield* say(
    `The virtual screen is on (${WIDTH}x${HEIGHT}), with browse connected to ${browsers.join(", ")}.`,
  );
}).pipe(Effect.withSpan("AgentBrowser.on"));

/** Stop Chromium, the virtual screen and its bus. */
export const agentBrowserOff = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  yield* requireStation;
  yield* executor.exitCode("systemctl", [
    "--user",
    "stop",
    ...UNITS.map((unit) => `${unit}.service`),
  ]);
  yield* say("The virtual screen and its browser are off.");
}).pipe(Effect.withSpan("AgentBrowser.off"));

/** Say which pieces are running and whether browse is connected. */
export const agentBrowserStatus = Effect.gen(function* () {
  yield* requireStation;

  for (const [unit, label] of [
    [BUS_UNIT, "Bus"],
    [KWIN_UNIT, "Virtual screen"],
    [CHROMIUM_UNIT, "Chromium"],
  ] as const)
    yield* say(`${label}: ${(yield* unitActive(unit)) ? "on" : "off"}`);

  const browsers = yield* browseConnected;

  yield* say(
    `browse: ${browsers.length > 0 ? `connected to ${browsers.join(", ")}` : "not connected"}`,
  );
}).pipe(Effect.withSpan("AgentBrowser.status"));

/** Fail unless `path` was written. */
const requireWritten = Effect.fn("AgentBrowser.requireWritten")(function* (
  path: string,
  what: string,
) {
  const fs = yield* FileSystem.FileSystem;

  const size = yield* fs.stat(path).pipe(
    Effect.map((info) => Number(info.size)),
    Effect.orElseSucceed(() => 0),
  );

  if (size === 0)
    return yield* new AgentBrowserError({ message: `${what} wasn't saved.` });
});

/** Save a PNG of the whole virtual screen, browser window included, with `tab` in front when given. */
export const agentBrowserShot = Effect.fn("AgentBrowser.shot")(function* (
  file: string,
  tab: string | undefined,
) {
  const executor = yield* CommandExecutor;
  const path = resolve(file);

  yield* requireScreen;

  if (tab) yield* bringToFront(tab);

  yield* executor.run("spectacle", ["-b", "-n", "-f", "-o", path], {
    env: SCREEN_ENV,
  });
  yield* requireWritten(path, "The screenshot");
  yield* say(path);
});

/** Record the whole virtual screen for a number of seconds, as MP4, with `tab` in front when given. */
export const agentBrowserRecord = Effect.fn("AgentBrowser.record")(function* (
  file: string,
  seconds: number,
  tab: string | undefined,
) {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const path = resolve(file);

  if (extname(path).toLowerCase() !== ".mp4")
    return yield* new AgentBrowserError({
      message: "Record to a .mp4 file.",
    });

  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_RECORD_SECONDS)
    return yield* new AgentBrowserError({
      message: `Record for 1 to ${MAX_RECORD_SECONDS} seconds.`,
    });

  yield* requireScreen;

  if (tab) yield* bringToFront(tab);

  const script = join(RUNTIME_DIR, "dot-agent-browser-record.qml");
  const raw = join(RUNTIME_DIR, "dot-agent-browser-record.mp4");

  yield* fs.writeFileString(script, RECORD_QML);
  yield* fs.remove(raw).pipe(Effect.ignore);
  yield* executor
    .run(QML_RUNNER, [script, raw, String(seconds)], {
      env: SCREEN_ENV,
    })
    .pipe(
      Effect.timeoutOption(
        Duration.sum(Duration.seconds(seconds), RECORD_SLACK),
      ),
    );
  yield* requireWritten(raw, "The recording");
  // KWin only sends a frame when the screen changes, so the raw recording
  // stops at the last change: a still screen is a single frame. Fill it out to
  // a steady 30 fps and hold the last frame to the full length.
  yield* executor.run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    raw,
    "-vf",
    `fps=30,tpad=stop_mode=clone:stop_duration=${seconds}`,
    "-t",
    String(seconds),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    path,
  ]);
  yield* fs.remove(raw).pipe(Effect.ignore);
  yield* requireWritten(path, "The recording");
  yield* say(path);
});
