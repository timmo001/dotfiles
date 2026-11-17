/**
 * @file `dot screen`: switch what's on Station's TV between Steam's gaming
 * mode, the Plasma desktop and nothing at all. Station boots to a text
 * console, so Plasma Login Manager only runs while a screen is on. CachyOS's
 * own `steam-set-session` picks the session it logs into, the same helper
 * Steam's "Switch to Desktop" goes through, so both stay in step.
 */

import { Effect, FileSystem, Schema } from "effect";
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

/** The screen couldn't be switched. */
export class ScreenError extends Schema.TaggedError<ScreenError>()(
  "ScreenError",
  { message: Schema.String },
) {}

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

/** Log in to Steam's gaming mode or Plasma on the TV, restarting whatever is there. */
export const screenOn = Effect.fn("Screen.on")(function* (
  session: ScreenSession,
) {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(SET_SESSION).pipe(Effect.orElseSucceed(() => false))))
    return yield* new ScreenError({
      message: `${SET_SESSION} is missing: install gamescope-session-cachyos (dot up, Missing packages)`,
    });

  // CachyOS's policy lets anyone run this helper through pkexec without a
  // password, so it needs no agent over SSH.
  const exitCode = yield* executor.exitCode("pkexec", [
    SET_SESSION,
    SESSIONS[session],
  ]);

  if (exitCode !== 0)
    return yield* new ScreenError({
      message: `steam-set-session ${SESSIONS[session]} exited ${exitCode}`,
    });

  yield* systemctl(["restart", LOGIN_MANAGER]);
  yield* Effect.sync(() =>
    process.stdout.write(
      session === "game"
        ? "Starting Steam's gaming mode on the TV\n"
        : "Starting the Plasma desktop on the TV\n",
    ),
  );
});

/** Close whatever is on screen, back to the text console. */
export const screenOff = Effect.gen(function* () {
  yield* systemctl(["stop", LOGIN_MANAGER]);
  yield* Effect.sync(() =>
    process.stdout.write("Closed the screen session; Station is headless\n"),
  );
}).pipe(Effect.withSpan("Screen.off"));

/** KDE's screen config, as much of it as dot screen hdr reads. */
const KScreenConfig = Schema.fromJsonString(
  Schema.Struct({
    outputs: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        connected: Schema.Boolean,
        enabled: Schema.Boolean,
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

/**
 * Turn on HDR and wide colour on every connected screen in the Plasma
 * session, with each screen's own EDID as its colour profile in SDR and HDR,
 * so the panel and the TV each get their own. KWin keeps the settings per
 * screen. A screen that can't do HDR is reported and left as it is.
 */
export const screenHdr = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const env = yield* plasmaSessionEnv;

  const config = yield* executor.run("kscreen-doctor", ["-j"], { env }).pipe(
    Effect.flatMap(Schema.decodeEffect(KScreenConfig)),
    Effect.mapError(
      (cause) =>
        new ScreenError({
          message: `Could not read the screens from kscreen-doctor: ${cause.message}`,
        }),
    ),
  );

  const screens = config.outputs.filter(
    (output) => output.connected && output.enabled,
  );

  for (const { name } of screens) {
    // One screen per call: KDE applies a call all or nothing, so a screen
    // without HDR would otherwise stop the rest.
    const exitCode = yield* executor.exitCode(
      "kscreen-doctor",
      [
        `output.${name}.hdr.enable`,
        `output.${name}.wcg.enable`,
        `output.${name}.colorProfileSource.EDID`,
        `output.${name}.hdrColorProfileSource.EDID`,
      ],
      { env },
    );

    yield* Effect.sync(() =>
      process.stdout.write(
        exitCode === 0
          ? `HDR on for ${name}, with its EDID colour profile\n`
          : `${name} didn't take HDR (kscreen-doctor exited ${exitCode}); it may not support it\n`,
      ),
    );
  }
}).pipe(Effect.withSpan("Screen.hdr"));

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

  const config = yield* executor.run("kscreen-doctor", ["-j"], { env }).pipe(
    Effect.flatMap(Schema.decodeEffect(KScreenConfig)),
    Effect.mapError(
      (cause) =>
        new ScreenError({
          message: `Could not read the screens from kscreen-doctor: ${cause.message}`,
        }),
    ),
  );

  const tv = config.outputs.find(
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

  const panels = config.outputs.filter(
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
  Effect.andThen(screenHdr),
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

/** Say what's on screen now, and what the login manager logs into next. */
export const screenStatus = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;

  const active = (unit: string, user: boolean) =>
    executor
      .exitCode("systemctl", [
        ...(user ? ["--user"] : []),
        "is-active",
        "--quiet",
        unit,
      ])
      .pipe(Effect.map((code) => code === 0));

  const running = (yield* active(LOGIN_MANAGER, false))
    ? (yield* active("gamescope-session.target", true))
      ? "Steam's gaming mode"
      : (yield* active("plasma-workspace.target", true))
        ? "the Plasma desktop"
        : "the login screen"
    : "nothing (headless)";

  const next = yield* fs.readFileString(AUTOLOGIN_DROP_IN).pipe(
    Effect.map(
      (text) => /^Session=(.+)$/m.exec(text)?.[1]?.trim() ?? "not set",
    ),
    Effect.orElseSucceed(() => "not set"),
  );

  yield* Effect.sync(() =>
    process.stdout.write(`On screen: ${running}\nNext login: ${next}\n`),
  );
}).pipe(Effect.withSpan("Screen.status"));
