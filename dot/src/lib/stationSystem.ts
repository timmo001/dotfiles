/**
 * @file Station's system setup: what an always-on server by the TV needs from
 * the system itself. The lid never suspends it, it boots to a text console
 * rather than a desktop, user services run without anyone logged in, sudo
 * needs no password, `dot screen` can start and stop the TV's session, and
 * RDP and game streaming start with that session, and Plasma has an on-screen
 * keyboard.
 * Each part checks first, so a machine already set up needs no elevation.
 */

import { Effect, FileSystem } from "effect";
import { userInfo } from "os";
import { join } from "path";
import { lines, query } from "./boundedQuery.js";
import { runElevated } from "./elevatedCommand.js";
import { done, skip, warn, type RecapEntry } from "./updateSummary.js";
import { cliStyler } from "./ansi.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";

/** The target Station boots into: no desktop until a session command starts one. */
const BOOT_TARGET = "multi-user.target";

/** Seconds a quick systemctl query may take. */
const QUERY_TIMEOUT = 30;

/** The short `dot screen` commands, installed on every shell's PATH. */
const SCREEN_COMMANDS = ["game", "desk", "headless"] as const;

/** A root-owned file Station needs, and what installing it is for. */
interface RootFile {
  /** Where it's installed. */
  readonly target: string;
  /** Its content. */
  readonly content: string;
  /** Its mode, such as `644`. */
  readonly mode: string;
  /** What it does, for the recap. */
  readonly label: string;
  /** A command run as root after installing it, such as a reload. */
  readonly after?: string;
  /** A command that checks the staged file (`$1`) first, such as visudo. */
  readonly validate?: string;
  /** Only root can read it, so it's read back through `sudo -n`. */
  readonly rootOnly?: boolean;
}

/**
 * Passwordless sudo for Station's user. Station runs unattended and is set up
 * and switched over SSH, where there's no one to type a password, the same
 * reason the screen commands get a polkit rule.
 */
const sudoersDropIn = (user: string) =>
  `# Written by dot for Station: ${user} runs sudo without a password.
${user} ALL=(ALL:ALL) NOPASSWD: ALL
`;

/**
 * Plasma Login Manager's main config. It logs `user` in automatically, and
 * back in when a session ends, as SteamOS does. The session itself comes from
 * the drop-in CachyOS's steam-set-session writes, which this file must not
 * set, since KConfig lets the main file override every drop-in.
 */
const plasmaLoginConfig = (user: string) =>
  `# Written by dot for Station. The session comes from
# /etc/plasmalogin.conf.d/zz-steamos-autologin.conf, which dot screen and
# Steam's Switch to Desktop set through steam-set-session.
[Autologin]
User=${user}
Relogin=true
`;

/** Every root-owned file Station needs, read from the public dotfiles. */
const rootFiles = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* Config;
  const station = join(config.publicDotfiles, "station");
  const read = (path: string) => fs.readFileString(join(station, path));

  const files: RootFile[] = [
    {
      target: "/etc/sudoers.d/50-station-nopasswd",
      content: sudoersDropIn(userInfo().username),
      mode: "440",
      label: "passwordless sudo",
      validate: 'visudo -cqf "$1"',
      rootOnly: true,
    },
    {
      target: "/etc/systemd/logind.conf.d/50-station-lid.conf",
      content: yield* read("logind.conf.d/50-station-lid.conf"),
      mode: "644",
      label: "the lid settings, so closing the lid never suspends",
      after: "systemctl kill -s HUP systemd-logind",
    },
    {
      target: "/etc/polkit-1/rules.d/50-dot-screen.rules",
      content: yield* read("polkit/50-dot-screen.rules"),
      mode: "644",
      label: "the polkit rule that lets dot screen start the login manager",
    },
    {
      target: "/etc/plasmalogin.conf",
      content: plasmaLoginConfig(userInfo().username),
      mode: "644",
      label: "Plasma Login Manager's autologin",
    },
  ];

  for (const name of SCREEN_COMMANDS)
    files.push({
      target: join("/usr/local/bin", name),
      content: yield* read(join("bin", name)),
      mode: "755",
      label: `the ${name} command`,
    });

  return files;
}).pipe(Effect.withSpan("StationSystem.rootFiles"));

/** Install a root-owned file when its content differs from what's wanted. */
const syncRootFile = Effect.fn("StationSystem.syncRootFile")(function* (
  file: RootFile,
) {
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;

  const installed = file.rootOnly
    ? yield* executor
        .run("sudo", ["-n", "cat", file.target])
        .pipe(Effect.orElseSucceed(() => null))
    : yield* fs
        .readFileString(file.target)
        .pipe(Effect.orElseSucceed(() => null));

  if (installed === file.content)
    return skip(`Already installed ${file.label}`);

  const staged = yield* fs.makeTempFileScoped({ prefix: "dot-station-" });

  yield* fs.writeFileString(staged, file.content);

  const exitCode = yield* runElevated("sh", [
    "-c",
    `set -e
${file.validate ?? ""}
install -Dm"$3" -o root -g root "$1" "$2"
${file.after ?? ""}`,
    "sh",
    staged,
    file.target,
    file.mode,
  ]);

  return exitCode === 0
    ? done(`Installed ${file.label}`)
    : warn(`Could not install ${file.label} (exit ${exitCode})`);
}, Effect.scoped);

/** Boot to a text console, leaving the desktop to the session commands. */
const ensureBootTarget = Effect.gen(function* () {
  const result = yield* query("systemctl", ["get-default"], QUERY_TIMEOUT);

  if (lines(result.stdout)[0] === BOOT_TARGET)
    return skip(`Already boots to ${BOOT_TARGET}`);

  const exitCode = yield* runElevated("systemctl", [
    "set-default",
    BOOT_TARGET,
  ]);

  return exitCode === 0
    ? done(`Set the boot target to ${BOOT_TARGET}`)
    : warn(`Could not set the boot target (exit ${exitCode})`);
}).pipe(Effect.withSpan("StationSystem.bootTarget"));

/** Let this user's services run from boot, with nobody logged in. */
const ensureLinger = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { username } = userInfo();

  const lingering = yield* fs
    .exists(join("/var/lib/systemd/linger", username))
    .pipe(Effect.orElseSucceed(() => false));

  if (lingering) return skip(`Lingering already on for ${username}`);

  const exitCode = yield* runElevated("loginctl", ["enable-linger", username]);

  return exitCode === 0
    ? done(
        `Turned on lingering for ${username}, so user services run from boot`,
      )
    : warn(`Could not turn on lingering (exit ${exitCode})`);
}).pipe(Effect.withSpan("StationSystem.linger"));

/**
 * Remote access that starts with a screen session rather than at boot: KRdp
 * with Plasma, and Sunshine with Plasma or gaming mode. Their logins stay
 * with the user (System Settings › Remote Desktop, and Sunshine's web UI).
 */
const SESSION_UNITS = [
  {
    unit: "app-org.kde.krdpserver.service",
    label: "KRdp, the RDP server, with Plasma",
  },
  {
    unit: "app-dev.lizardbyte.app.Sunshine.service",
    label: "Sunshine, the game stream host, with any screen session",
  },
] as const;

/**
 * Enable a session-bound user unit without starting it: it starts with the
 * next screen session, and Station boots without one.
 */
const ensureSessionUnit = Effect.fn("StationSystem.sessionUnit")(function* ({
  unit,
  label,
}: (typeof SESSION_UNITS)[number]) {
  const state = yield* query(
    "systemctl",
    ["--user", "is-enabled", unit],
    QUERY_TIMEOUT,
  );

  if (lines(state.stdout)[0] === "enabled")
    return skip(`Already starts ${label}`);

  if (
    lines(state.stdout)[0] === "not-found" ||
    state.stderr.includes("not found")
  )
    return warn(`Not installed: ${unit}`);

  const result = yield* query(
    "systemctl",
    ["--user", "enable", unit],
    QUERY_TIMEOUT,
  );

  return result.code === 0
    ? done(`Enabled ${label}`)
    : warn(`Could not enable ${unit}: ${result.stderr.trim()}`);
});

/** Plasma's on-screen keyboard, from the plasma-keyboard package. */
const VIRTUAL_KEYBOARD =
  "/usr/share/applications/org.kde.plasma.keyboard.desktop";

/**
 * Pick Plasma's on-screen keyboard as KWin's input method, for the sofa
 * without a keyboard. KDE rewrites kwinrc itself, so it's set with
 * kwriteconfig6 rather than stowed; it takes effect at the next Plasma login.
 */
const ensureVirtualKeyboard = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const key = [
    "--file",
    "kwinrc",
    "--group",
    "Wayland",
    "--key",
    "InputMethod",
  ];

  if (
    !(yield* fs
      .exists(VIRTUAL_KEYBOARD)
      .pipe(Effect.orElseSucceed(() => false)))
  )
    return warn("Not installed: plasma-keyboard, the on-screen keyboard");

  const current = yield* query("kreadconfig6", key, QUERY_TIMEOUT);

  if (lines(current.stdout)[0] === VIRTUAL_KEYBOARD)
    return skip("Already uses Plasma's on-screen keyboard");

  const result = yield* query(
    "kwriteconfig6",
    ["--notify", ...key, VIRTUAL_KEYBOARD],
    QUERY_TIMEOUT,
  );

  return result.code === 0
    ? done("Picked Plasma's on-screen keyboard, from the next Plasma login")
    : warn(`Could not pick the on-screen keyboard: ${result.stderr.trim()}`);
}).pipe(Effect.withSpan("StationSystem.virtualKeyboard"));

/** Apply Station's system setup, returning what each part did. */
export const syncStationSystem = Effect.gen(function* () {
  const actions: RecapEntry[] = [];

  const files = yield* rootFiles.pipe(
    Effect.catch((error) =>
      Effect.succeed(
        warn(`Could not read Station's system files: ${error.message}`),
      ),
    ),
  );

  if (Array.isArray(files)) {
    for (const file of files)
      actions.push(
        yield* syncRootFile(file).pipe(
          Effect.catch((error) =>
            Effect.succeed(
              warn(`Could not install ${file.label}: ${error.message}`),
            ),
          ),
        ),
      );
  } else {
    actions.push(files);
  }

  actions.push(yield* ensureBootTarget);
  actions.push(yield* ensureLinger);

  for (const sessionUnit of SESSION_UNITS)
    actions.push(yield* ensureSessionUnit(sessionUnit));

  actions.push(yield* ensureVirtualKeyboard);

  return actions;
}).pipe(Effect.withSpan("StationSystem.sync"));

/** Apply Station's system setup and log what each part did. */
export const applyStationSystem = Effect.gen(function* () {
  const log = yield* OutputLog;

  yield* log.section("Station System");

  for (const entry of yield* syncStationSystem) {
    if (entry.status === "warn") yield* log.warn(entry.message);
    else if (entry.status === "done") yield* log.success(entry.message);
    else yield* log.info(cliStyler().dim(entry.message));
  }
}).pipe(Effect.withSpan("StationSystem.apply"));
