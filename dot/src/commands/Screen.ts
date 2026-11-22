/**
 * @file `dot screen`: switch what's on Station's TV between Steam's gaming
 * mode, the Plasma desktop, a Moonlight stream and nothing at all. Station
 * boots to a text console, so Plasma Login Manager only runs while a screen
 * is on. CachyOS's own `steam-set-session` picks the session it logs into,
 * the same helper Steam's "Switch to Desktop" goes through, so both stay in
 * step.
 */

import { Effect, FileSystem, Option, Schema } from "effect";
import { join } from "path";
import { ENV, envString } from "../lib/env.js";
import { HOME_DIR } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** Plasma Login Manager, which logs in to the chosen session on the TV. */
const LOGIN_MANAGER = "plasmalogin.service";

/** CachyOS's helper that writes the login manager's autologin session. */
const SET_SESSION = "/usr/lib/steamos/steam-set-session";

/** The drop-in `steam-set-session` writes, read back for `dot screen status`. */
const AUTOLOGIN_DROP_IN = "/etc/plasmalogin.conf.d/zz-steamos-autologin.conf";

/** What can be on screen, and the session file each logs into. */
const SESSIONS = {
  game: "gamescope-session.desktop",
  desktop: "plasma.desktop",
} as const;

/** A screen with something on it. */
export type ScreenSession = keyof typeof SESSIONS;

/** The login session that shows a Moonlight stream in gamescope, installed by dot up. */
const MOONLIGHT_SESSION = "dot-moonlight.desktop";

/** Where dot up installs the Moonlight session for the login manager. */
const MOONLIGHT_SESSION_FILE = join(
  "/usr/local/share/wayland-sessions",
  MOONLIGHT_SESSION,
);

/** This user's runtime directory, cleared at logout and boot. */
const RUNTIME_DIR = `/run/user/${process.getuid?.() ?? 1000}`;

/** The stream dot screen moonlight asked for, kept while it's on screen. */
const MOONLIGHT_STATE = join(RUNTIME_DIR, "dot-screen-moonlight.json");

/** gamescope's mode file for the Moonlight session. */
const MOONLIGHT_MODES = join(RUNTIME_DIR, "dot-screen-moonlight-modes.cfg");

/** The modes gaming mode saved per screen, as `description:WxH@Hz [range]`. */
const STEAM_MODES = join(HOME_DIR, ".config", "gamescope", "modes.cfg");

/** gamescope's Broadcast RGB value for full-range colour. */
const FULL_RANGE = 1;

const MoonlightState = Schema.Struct({
  /** The Sunshine host to stream from. */
  host: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
  fps: Schema.Int,
  /** Nothing was on screen before, so the login manager stops afterwards. */
  headless: Schema.Boolean,
  /** The session the login manager logged into before, put back afterwards. */
  nextLogin: Schema.String,
});

/** The stream dot screen moonlight asked for. */
type MoonlightState = typeof MoonlightState.Type;

const MoonlightStateJson = Schema.fromJsonString(MoonlightState);

/** The screen couldn't be switched. */
export class ScreenError extends Schema.TaggedError<ScreenError>()(
  "ScreenError",
  { message: Schema.String },
) {}

const say = (line: string) =>
  Effect.sync(() => process.stdout.write(`${line}\n`));

/** The Moonlight stream on screen, if there is one. */
const readMoonlightState = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs
    .readFileString(MOONLIGHT_STATE)
    .pipe(
      Effect.flatMap(Schema.decodeEffect(MoonlightStateJson)),
      Effect.option,
    );
}).pipe(Effect.withSpan("Screen.readMoonlightState"));

/** Forget the Moonlight stream, once something else takes the screen. */
const clearMoonlightState = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  yield* fs
    .remove(MOONLIGHT_STATE, { force: true })
    .pipe(Effect.orElseSucceed(() => undefined));
}).pipe(Effect.withSpan("Screen.clearMoonlightState"));

const systemctl = Effect.fn("Screen.systemctl")(function* (
  args: readonly string[],
) {
  const executor = yield* CommandExecutor;

  // polkit lets wheel users start, stop and restart the login manager without
  // a password (station/polkit/50-dot-screen.rules), so this works over SSH.
  const exitCode = yield* executor.exitCode("systemctl", [
    "--no-ask-password",
    ...args,
  ]);

  if (exitCode !== 0)
    return yield* new ScreenError({
      message: `systemctl ${args.join(" ")} exited ${exitCode}`,
    });
});

/** Pick the session the login manager logs into next. */
const setSession = Effect.fn("Screen.setSession")(function* (session: string) {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(SET_SESSION).pipe(Effect.orElseSucceed(() => false))))
    return yield* new ScreenError({
      message: `${SET_SESSION} is missing: install gamescope-session-cachyos (dot up, Missing packages)`,
    });

  // CachyOS's policy lets anyone run this helper through pkexec without a
  // password, so it needs no agent over SSH.
  const exitCode = yield* executor.exitCode("pkexec", [SET_SESSION, session]);

  if (exitCode !== 0)
    return yield* new ScreenError({
      message: `steam-set-session ${session} exited ${exitCode}`,
    });
});

/** Log in to Steam's gaming mode or Plasma on the TV, restarting whatever is there. */
export const screenOn = Effect.fn("Screen.on")(function* (
  session: ScreenSession,
) {
  yield* setSession(SESSIONS[session]);
  yield* clearMoonlightState;
  yield* systemctl(["restart", LOGIN_MANAGER]);
  yield* say(
    session === "game"
      ? "Starting Steam's gaming mode on the TV"
      : "Starting the Plasma desktop on the TV",
  );
});

/** Close whatever is on screen, back to the text console. */
export const screenOff = Effect.gen(function* () {
  yield* clearMoonlightState;
  yield* systemctl(["stop", LOGIN_MANAGER]);
  yield* say("Closed the screen session; Station is headless");
}).pipe(Effect.withSpan("Screen.off"));

/** KDE's screen config, as much of it as dot screen and dot hdr read. */
const KScreenConfig = Schema.fromJsonString(
  Schema.Struct({
    outputs: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        connected: Schema.Boolean,
        enabled: Schema.Boolean,
        hdr: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  }),
);

/**
 * The environment that reaches the running Plasma session from any shell,
 * SSH included: its runtime directory, session bus and Wayland socket.
 */
const plasmaSessionEnv = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const runtime = `/run/user/${process.getuid?.() ?? 1000}`;

  const socket =
    envString(ENV.WAYLAND_DISPLAY) ??
    (yield* fs
      .readDirectory(runtime)
      .pipe(Effect.orElseSucceed((): string[] => [])))
      .filter((name) => /^wayland-\d+$/.test(name))
      .sort()[0];

  if (!socket)
    return yield* new ScreenError({
      message:
        "No Wayland session is running: start one with dot screen desktop",
    });

  return {
    XDG_RUNTIME_DIR: runtime,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus`,
    WAYLAND_DISPLAY: socket,
    QT_QPA_PLATFORM: "wayland",
  };
}).pipe(Effect.withSpan("Screen.plasmaSessionEnv"));

/** Read the Plasma session's screens through kscreen-doctor. */
const readScreens = Effect.fn("Screen.readScreens")(function* (
  env: Readonly<Record<string, string>>,
) {
  const executor = yield* CommandExecutor;

  return yield* executor.run("kscreen-doctor", ["-j"], { env }).pipe(
    Effect.flatMap(Schema.decodeEffect(KScreenConfig)),
    Effect.map((config) => config.outputs),
    Effect.mapError(
      (cause) =>
        new ScreenError({
          message: `Could not read the screens from kscreen-doctor: ${cause.message}`,
        }),
    ),
  );
});

/** Whether any screen in the Plasma session is in HDR. */
export const plasmaHdrEnabled = Effect.gen(function* () {
  const screens = yield* readScreens(yield* plasmaSessionEnv);

  return screens.some(
    (screen) => screen.connected && screen.enabled && screen.hdr === true,
  );
}).pipe(Effect.withSpan("Screen.plasmaHdrEnabled"));

/**
 * Switch HDR and wide colour on or off on every connected screen in the
 * Plasma session. On also sets each screen's own EDID as its colour profile in
 * SDR and HDR, so the panel and the TV each get their own. KWin keeps the
 * settings per screen. A screen that can't do HDR is reported and left as it is.
 */
export const plasmaHdr = Effect.fn("Screen.plasmaHdr")(function* (
  state: "on" | "off",
) {
  const executor = yield* CommandExecutor;
  const env = yield* plasmaSessionEnv;

  const screens = (yield* readScreens(env)).filter(
    (screen) => screen.connected && screen.enabled,
  );

  for (const { name, hdr } of screens) {
    if (state === "off" && hdr !== true) {
      yield* Effect.sync(() =>
        process.stdout.write(`HDR is already off on ${name}\n`),
      );

      continue;
    }

    // One screen per call: KDE applies a call all or nothing, so a screen
    // without HDR would otherwise stop the rest.
    const exitCode = yield* executor.exitCode(
      "kscreen-doctor",
      state === "on"
        ? [
            `output.${name}.hdr.enable`,
            `output.${name}.wcg.enable`,
            `output.${name}.colorProfileSource.EDID`,
            `output.${name}.hdrColorProfileSource.EDID`,
          ]
        : [`output.${name}.hdr.disable`, `output.${name}.wcg.disable`],
      { env },
    );

    yield* Effect.sync(() =>
      process.stdout.write(
        exitCode !== 0
          ? `${name} didn't take HDR ${state} (kscreen-doctor exited ${exitCode})${state === "on" ? "; it may not support it" : ""}\n`
          : state === "on"
            ? `HDR on for ${name}, with its EDID colour profile\n`
            : `HDR off for ${name}\n`,
      ),
    );
  }
});

/** Built-in panels, which only lead when nothing else is connected. */
const INTERNAL_OUTPUT = /^(eDP|LVDS|DSI)-/;

/** The TV's scale in the Plasma desktop: 250%, a 1536x864 desktop at 4K. */
const TV_SCALE = "2.5";

/** Where ACPI reports the lid, as `state: open` or `state: closed`. */
const LID_DIR = "/proc/acpi/button/lid";

/**
 * Whether the laptop's lid is shut. Station's logind ignores the lid so it
 * never suspends, and KWin leaves the panel on too, so Plasma and Steam's Big
 * Picture would otherwise count the shut panel as a screen.
 */
const lidClosed = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const lids = yield* fs
    .readDirectory(LID_DIR)
    .pipe(Effect.orElseSucceed((): string[] => []));

  for (const lid of lids) {
    const state = yield* fs
      .readFileString(join(LID_DIR, lid, "state"))
      .pipe(Effect.orElseSucceed(() => ""));

    if (state.includes("closed")) return true;
  }

  return false;
}).pipe(Effect.withSpan("Screen.lidClosed"));

/** The kernel's DRM connectors, such as `card1-DP-3`. */
const DRM_CLASS = "/sys/class/drm";

/**
 * Read the TV's EDID again when the kernel lost it. Coming back from gaming
 * mode, the kernel sometimes reads no EDID through the USB-C to HDMI link, so
 * the TV only offers 640x480 and the like, and KWin can't match its saved
 * settings. Probing the connector again and telling KWin brings its real
 * modes back. Station's sudo needs no password, so this works at login.
 */
const reprobeBlankEdid = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;
  const blank: string[] = [];

  const entries = yield* fs
    .readDirectory(DRM_CLASS)
    .pipe(Effect.orElseSucceed((): string[] => []));

  for (const entry of entries) {
    const connector = /^card\d+-(.+)$/.exec(entry)?.[1];

    if (!connector || INTERNAL_OUTPUT.test(connector)) continue;

    const status = yield* fs
      .readFileString(join(DRM_CLASS, entry, "status"))
      .pipe(Effect.orElseSucceed(() => ""));

    if (status.trim() !== "connected") continue;

    const edid = yield* fs
      .readFile(join(DRM_CLASS, entry, "edid"))
      .pipe(Effect.orElseSucceed(() => new Uint8Array()));

    if (edid.length === 0) blank.push(entry);
  }

  if (blank.length === 0) return;

  for (const entry of blank)
    yield* executor.exitCode("sudo", [
      "-n",
      "sh",
      "-c",
      `echo detect > ${join(DRM_CLASS, entry, "status")}`,
    ]);

  yield* executor.exitCode("sudo", [
    "-n",
    "udevadm",
    "trigger",
    "--action=change",
    "--subsystem-match=drm",
  ]);

  // KWin picks up the new modes from the change event.
  yield* Effect.sleep("4 seconds");

  yield* Effect.sync(() =>
    process.stdout.write(
      `Read the EDID again for ${blank.map((entry) => entry.replace(/^card\d+-/, "")).join(", ")}\n`,
    ),
  );
}).pipe(Effect.withSpan("Screen.reprobeBlankEdid"));

/**
 * Make the TV Plasma's main screen, with the panel and new windows: the first
 * connected screen that isn't the laptop's own panel. With only the panel
 * connected, nothing changes.
 */
export const screenTvFirst = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const env = yield* plasmaSessionEnv;

  yield* reprobeBlankEdid;

  const outputs = yield* readScreens(env);

  const tv = outputs.find(
    (output) =>
      output.connected && output.enabled && !INTERNAL_OUTPUT.test(output.name),
  );

  if (!tv) {
    yield* Effect.sync(() =>
      process.stdout.write(
        "No TV connected; the panel stays the main screen\n",
      ),
    );

    return;
  }

  const exitCode = yield* executor.exitCode(
    "kscreen-doctor",
    [`output.${tv.name}.priority.1`, `output.${tv.name}.scale.${TV_SCALE}`],
    { env },
  );

  if (exitCode !== 0)
    return yield* new ScreenError({
      message: `Could not make ${tv.name} the main screen (kscreen-doctor exited ${exitCode})`,
    });

  yield* Effect.sync(() =>
    process.stdout.write(
      `${tv.name} is the main screen, at ${Number(TV_SCALE) * 100}%\n`,
    ),
  );

  // With the lid shut, the panel is a screen nobody can see.
  const closed = yield* lidClosed;

  const panels = outputs.filter(
    (output) => output.connected && INTERNAL_OUTPUT.test(output.name),
  );

  for (const panel of panels) {
    if (panel.enabled === !closed) continue;

    const panelExit = yield* executor.exitCode(
      "kscreen-doctor",
      [`output.${panel.name}.${closed ? "disable" : "enable"}`],
      { env },
    );

    yield* Effect.sync(() =>
      process.stdout.write(
        panelExit === 0
          ? `${closed ? "Switched off" : "Switched on"} ${panel.name}: the lid is ${closed ? "shut" : "open"}\n`
          : `Could not switch ${panel.name} ${closed ? "off" : "on"} (kscreen-doctor exited ${panelExit})\n`,
      ),
    );
  }
}).pipe(Effect.withSpan("Screen.tvFirst"));

/** Make the TV the main screen, then turn on HDR everywhere: what Plasma runs at login. */
export const screenSetup = screenTvFirst.pipe(
  Effect.andThen(plasmaHdr("on")),
  Effect.withSpan("Screen.setup"),
);

/** KWin's virtual keyboard on the session bus, as busctl arguments. */
const KWIN_KEYBOARD = [
  "org.kde.KWin",
  "/VirtualKeyboard",
  "org.kde.kwin.VirtualKeyboard",
] as const;

/**
 * Show Plasma's on-screen keyboard, or hide it when it's showing. KWin only
 * brings it up by itself after touch input, so a mouse, a controller in
 * Steam's desktop layout, Moonlight or RDP need this to call it up.
 */
export const screenKeyboard = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const env = yield* plasmaSessionEnv;

  const busctl = (args: readonly string[]) =>
    executor.run("busctl", ["--user", ...args], { env }).pipe(
      Effect.mapError(
        (cause) =>
          new ScreenError({
            message: `Could not reach KWin's virtual keyboard: ${cause.message}`,
          }),
      ),
    );

  const visible = yield* busctl(["get-property", ...KWIN_KEYBOARD, "visible"]);

  if (visible.trim() === "b true") {
    yield* busctl(["set-property", ...KWIN_KEYBOARD, "active", "b", "false"]);

    yield* Effect.sync(() =>
      process.stdout.write("Hid the on-screen keyboard\n"),
    );

    return;
  }

  yield* busctl(["set-property", ...KWIN_KEYBOARD, "active", "b", "true"]);
  yield* busctl(["call", ...KWIN_KEYBOARD, "forceActivate"]);

  yield* Effect.sync(() =>
    process.stdout.write("Showing the on-screen keyboard\n"),
  );
}).pipe(Effect.withSpan("Screen.keyboard"));

/** Steam's client beta choice, which both of Steam's clients read and write. */
const STEAM_BETA_FILE = join(
  HOME_DIR,
  ".local",
  "share",
  "Steam",
  "package",
  "beta",
);

/**
 * The beta name each Steam client understands for the choice in the file.
 * Gaming mode runs the Steam Deck client, whose betas are `steamdeck_*`, and
 * the desktop runs the normal client, whose only beta is `publicbeta`. Each
 * resets a name it doesn't know to its own stable channel, so without this a
 * beta chosen in one mode was lost on the switch to the other. Returns the
 * name to write, `null` for stable, or `undefined` to leave the file alone.
 */
const steamBetaFor = (
  mode: "game" | "desktop",
  current: string,
): string | null | undefined => {
  if (mode === "game")
    return current === "publicbeta" ? "steamdeck_publicbeta" : undefined;

  if (current === "steamdeck_publicbeta" || current === "steamdeck_beta")
    return "publicbeta";

  return current === "steamdeck_stable" ? null : undefined;
};

/**
 * Keep the Steam beta chosen in one mode for the other: translate the shared
 * beta file into the name the gaming mode or desktop client understands,
 * before that client starts.
 */
export const screenSteamBeta = Effect.fn("Screen.steamBeta")(function* (
  mode: "game" | "desktop",
) {
  const fs = yield* FileSystem.FileSystem;

  const current = (yield* fs
    .readFileString(STEAM_BETA_FILE)
    .pipe(Effect.orElseSucceed(() => ""))).trim();

  const next = steamBetaFor(mode, current);

  if (next === undefined) return;

  if (next === null) yield* fs.remove(STEAM_BETA_FILE, { force: true });
  else yield* fs.writeFileString(STEAM_BETA_FILE, `${next}\n`);

  yield* Effect.sync(() =>
    process.stdout.write(
      `Steam beta for ${mode === "game" ? "gaming mode" : "the desktop"}: ${next ?? "stable"} (was ${current})\n`,
    ),
  );
});

/** What the login manager logs into next, from steam-set-session's drop-in. */
const readNextLogin = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readFileString(AUTOLOGIN_DROP_IN).pipe(
    Effect.map((text) => /^Session=(.+)$/m.exec(text)?.[1]?.trim()),
    Effect.orElseSucceed(() => undefined),
  );
}).pipe(Effect.withSpan("Screen.readNextLogin"));

/** What's on screen now. */
const onScreen = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const active = (unit: string, user: boolean) =>
    executor
      .exitCode("systemctl", [
        ...(user ? ["--user"] : []),
        "is-active",
        "--quiet",
        unit,
      ])
      .pipe(Effect.map((code) => code === 0));

  if (!(yield* active(LOGIN_MANAGER, false))) return "off" as const;

  if (yield* active("gamescope-session.target", true)) return "game" as const;

  if (yield* active("plasma-workspace.target", true)) return "desktop" as const;

  return Option.isSome(yield* readMoonlightState)
    ? ("moonlight" as const)
    : ("login" as const);
}).pipe(Effect.withSpan("Screen.onScreen"));

/** The connected screens other than the laptop's own panel, such as `DP-2`. */
const externalOutputs = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const outputs: string[] = [];

  const entries = yield* fs
    .readDirectory(DRM_CLASS)
    .pipe(Effect.orElseSucceed((): string[] => []));

  for (const entry of entries.sort()) {
    const connector = /^card\d+-(.+)$/.exec(entry)?.[1];

    if (!connector || INTERNAL_OUTPUT.test(connector)) continue;

    const status = yield* fs
      .readFileString(join(DRM_CLASS, entry, "status"))
      .pipe(Effect.orElseSucceed(() => ""));

    if (status.trim() === "connected") outputs.push(connector);
  }

  return outputs;
}).pipe(Effect.withSpan("Screen.externalOutputs"));

/**
 * Write gamescope's mode file for the stream: each screen gaming mode saved a
 * mode for, at the stream's refresh rate and in full-range colour. At 4K 60 Hz
 * the link has room for 10-bit colour, and Intel's driver then picks limited
 * range by itself; the USB-C to HDMI adapter doesn't tell the TV, so it
 * reads it as full range and the picture looks washed out. Returns whether
 * there was anything to write.
 */
const writeMoonlightModes = Effect.fn("Screen.writeMoonlightModes")(function* (
  fps: number,
) {
  const fs = yield* FileSystem.FileSystem;

  const saved = yield* fs
    .readFileString(STEAM_MODES)
    .pipe(Effect.orElseSucceed(() => ""));

  const modes = saved.split("\n").flatMap((line) => {
    const mode = /^([^:]+):(\d+)x(\d+)@\d+/.exec(line);

    return mode
      ? [`${mode[1]}:${mode[2]}x${mode[3]}@${fps} ${FULL_RANGE}`]
      : [];
  });

  if (modes.length === 0) return false;

  yield* fs.writeFileString(MOONLIGHT_MODES, `${modes.join("\n")}\n`);

  return true;
});

/**
 * Show a Moonlight stream from `host` full screen on the TV, in its own login
 * session, replacing whatever is there; closing Moonlight puts that back.
 * gamescope runs it rather than KWin, since KWin never tells the TV it has
 * left HDR, and the TV behind the USB-C to HDMI adapter then stays in HDR.
 */
export const screenMoonlight = Effect.fn("Screen.moonlight")(function* (
  stream: Pick<MoonlightState, "host" | "width" | "height" | "fps">,
) {
  const fs = yield* FileSystem.FileSystem;

  if (
    !(yield* fs
      .exists(MOONLIGHT_SESSION_FILE)
      .pipe(Effect.orElseSucceed(() => false)))
  )
    return yield* new ScreenError({
      message: `${MOONLIGHT_SESSION_FILE} is missing: install it with dot up`,
    });

  const current = yield* onScreen;

  // Streaming again keeps what was on screen before the first stream.
  const before =
    current === "moonlight"
      ? Option.getOrUndefined(yield* readMoonlightState)
      : undefined;

  // The running session, since the desktop points the next login back at
  // gaming mode as soon as it starts.
  const nextLogin =
    before?.nextLogin ??
    (current === "game" || current === "desktop"
      ? SESSIONS[current]
      : yield* readNextLogin);

  const state: MoonlightState = {
    ...stream,
    headless: before?.headless ?? current === "off",
    nextLogin:
      nextLogin === undefined || nextLogin === MOONLIGHT_SESSION
        ? SESSIONS.desktop
        : nextLogin,
  };

  yield* fs.writeFileString(
    MOONLIGHT_STATE,
    yield* Schema.encodeEffect(MoonlightStateJson)(state),
  );
  yield* setSession(MOONLIGHT_SESSION);
  yield* systemctl(["restart", LOGIN_MANAGER]);
  yield* say(
    `Starting Moonlight on the TV, streaming ${stream.host} at ${stream.width}x${stream.height}@${stream.fps}`,
  );
});

/**
 * The Moonlight login session itself: run Moonlight in gamescope until it
 * closes, then go back to what was on screen before. The login manager logs
 * back in by itself (Relogin), so this only points it at the earlier session,
 * or stops it when nothing was on screen.
 */
export const screenMoonlightSession = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const state = yield* readMoonlightState;

  if (Option.isNone(state)) {
    // Never log back in to this session, which would only end again.
    yield* setSession(SESSIONS.desktop);

    return yield* new ScreenError({
      message: "No stream to show: start one with dot screen moonlight <host>",
    });
  }

  const { host, width, height, fps, headless, nextLogin } = state.value;

  // Set it now, so a crash can't log back in to this session over and over.
  yield* setSession(nextLogin);
  yield* reprobeBlankEdid;

  const outputs = yield* externalOutputs;
  const modes = yield* writeMoonlightModes(fps);

  yield* executor.inherit(
    "gamescope",
    [
      "--backend",
      "drm",
      ...(outputs.length > 0 ? ["--prefer-output", outputs.join(",")] : []),
      "-w",
      String(width),
      "-h",
      String(height),
      "-f",
      "--",
      "moonlight",
      "stream",
      host,
      "Desktop",
      "--resolution",
      `${width}x${height}`,
      "--fps",
      String(fps),
      "--display-mode",
      "fullscreen",
      "--audio-on-host",
    ],
    modes ? { env: { GAMESCOPE_MODE_SAVE_FILE: MOONLIGHT_MODES } } : undefined,
  );

  // Another dot screen command already took over the screen.
  if (Option.isNone(yield* readMoonlightState)) return;

  yield* clearMoonlightState;

  if (headless) yield* systemctl(["stop", LOGIN_MANAGER]);
}).pipe(Effect.withSpan("Screen.moonlightSession"));

/** Close the Moonlight stream, so the TV goes back to what was there before. */
export const screenBack = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  if ((yield* onScreen) !== "moonlight") {
    yield* say("Moonlight isn't on screen");

    return;
  }

  // The session goes back by itself once Moonlight, and so gamescope, ends.
  yield* executor.exitCode("pkill", [
    "-u",
    String(process.getuid?.() ?? 1000),
    "-x",
    "moonlight",
  ]);
  yield* say("Closed Moonlight; the TV goes back to what was there before");
}).pipe(Effect.withSpan("Screen.back"));

/** Say what's on screen now, and what the login manager logs into next. */
export const screenStatus = Effect.gen(function* () {
  const current = yield* onScreen;

  const running =
    current === "moonlight"
      ? `Moonlight, streaming ${Option.match(yield* readMoonlightState, {
          onNone: () => "nothing",
          onSome: (state) => state.host,
        })}`
      : {
          game: "Steam's gaming mode",
          desktop: "the Plasma desktop",
          login: "the login screen",
          off: "nothing (headless)",
        }[current];

  const next = (yield* readNextLogin) ?? "not set";

  const hdr =
    current === "desktop"
      ? `HDR: ${yield* plasmaHdrEnabled.pipe(
          Effect.map((enabled) => (enabled ? "on" : "off")),
          Effect.orElseSucceed(() => "unknown"),
        )}\n`
      : "";

  // dot station screen on the laptop reads this line, to know when Moonlight closes.
  yield* Effect.sync(() =>
    process.stdout.write(`On screen: ${running}\nNext login: ${next}\n${hdr}`),
  );
}).pipe(Effect.withSpan("Screen.status"));
