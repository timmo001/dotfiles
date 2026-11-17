/**
 * @file `dot screen`: switch what's on Station's TV between Steam's gaming
 * mode, the Plasma desktop and nothing at all. Station boots to a text
 * console, so Plasma Login Manager only runs while a screen is on. CachyOS's
 * own `steam-set-session` picks the session it logs into, the same helper
 * Steam's "Switch to Desktop" goes through, so both stay in step.
 */

import { Effect, FileSystem, Schema } from "effect";
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
