/**
 * @file Station's system setup: what an always-on server by the TV needs from
 * the system itself. The lid never suspends it, it boots to a text console
 * rather than a desktop, and user services run without anyone logged in.
 * Each part checks first, so a machine already set up needs no elevation.
 */

import { Effect, FileSystem } from "effect";
import { userInfo } from "os";
import { join } from "path";
import { lines, query } from "./boundedQuery.js";
import { runElevated } from "./elevatedCommand.js";
import { done, skip, warn, type RecapEntry } from "./updateSummary.js";
import { Config } from "../services/Config.js";

/** The lid drop-in's name, in the dotfiles and installed. */
const LOGIND_DROP_IN = "50-station-lid.conf";

/** Where logind reads drop-ins from. */
const LOGIND_DROP_IN_DIR = "/etc/systemd/logind.conf.d";

/** The target Station boots into: no desktop until a session command starts one. */
const BOOT_TARGET = "multi-user.target";

/** Seconds a quick systemctl query may take. */
const QUERY_TIMEOUT = 30;

/**
 * Install the lid drop-in root-owned when it differs from the dotfiles, then
 * have logind reload its config. Plasma's power management overrides the lid
 * while a desktop runs; this covers every other time.
 */
const syncLogindDropIn = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* Config;
  const target = join(LOGIND_DROP_IN_DIR, LOGIND_DROP_IN);

  const source = join(
    config.publicDotfiles,
    "station",
    "logind.conf.d",
    LOGIND_DROP_IN,
  );

  const current = yield* Effect.all([
    fs.readFileString(source),
    fs.readFileString(target),
  ]).pipe(
    Effect.map(([wanted, installed]) => wanted === installed),
    Effect.orElseSucceed(() => false),
  );

  if (current) return skip("Lid settings already installed");

  const exitCode = yield* runElevated("sh", [
    "-c",
    `set -e
install -Dm644 "$1" "$2"
systemctl kill -s HUP systemd-logind`,
    "sh",
    source,
    target,
  ]);

  return exitCode === 0
    ? done("Installed the lid settings, so closing the lid never suspends")
    : warn(`Could not install the lid settings (exit ${exitCode})`);
}).pipe(Effect.withSpan("StationSystem.logind"));

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

/** Apply Station's system setup, returning what each part did. */
export const syncStationSystem = Effect.gen(function* () {
  const actions: RecapEntry[] = [];

  actions.push(yield* syncLogindDropIn);
  actions.push(yield* ensureBootTarget);
  actions.push(yield* ensureLinger);

  return actions;
}).pipe(Effect.withSpan("StationSystem.sync"));
