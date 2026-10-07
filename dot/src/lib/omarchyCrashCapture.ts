import { dirname, join } from "node:path";
import { Effect, FileSystem } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { cliStyler } from "./ansi.js";
import { pathExists } from "./fsProbe.js";
import { HOME_DIR, displayPath } from "./paths.js";
import { notable, skip } from "./updateSummary.js";
import type { RecapEntry } from "./updateSummary.js";

/** Omarchy's crash notification watcher, shipped by the omarchy package. */
const CRASH_WATCH_UNIT = "omarchy-crash-watch.service";

/** Where Omarchy installs the watcher; absent on hosts without Omarchy. */
const CRASH_WATCH_UNIT_PATH = join("/usr/lib/systemd/user", CRASH_WATCH_UNIT);

/**
 * The flag `omarchy-toggle-crash-capture` sets. Omarchy reads it from
 * `$HOME/.local/state` regardless of `XDG_STATE_HOME`.
 */
const CRASH_CAPTURE_OFF_FLAG = join(
  HOME_DIR,
  ".local",
  "state",
  "omarchy",
  "toggles",
  "crash-capture-off",
);

/**
 * Turn off Omarchy's crash notifications, which triage replaces.
 *
 * Sets the same flag as `omarchy-toggle-crash-capture` and stops the watcher
 * for the current session; the unit's `ConditionPathExists` keeps it stopped
 * on later logins. A no-op on hosts without the watcher or with the flag set.
 */
export const disableOmarchyCrashCapture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;
  const entries: RecapEntry[] = [];

  if (!(yield* pathExists(CRASH_WATCH_UNIT_PATH))) return entries;

  if (yield* pathExists(CRASH_CAPTURE_OFF_FLAG)) {
    yield* log.info(cliStyler().dim("Omarchy crash notifications already off"));
    entries.push(skip("Omarchy crash notifications already off"));

    return entries;
  }

  yield* fs
    .makeDirectory(dirname(CRASH_CAPTURE_OFF_FLAG), { recursive: true })
    .pipe(Effect.orDie);
  yield* fs.writeFileString(CRASH_CAPTURE_OFF_FLAG, "").pipe(Effect.orDie);
  yield* executor.exitCode("systemctl", ["--user", "stop", CRASH_WATCH_UNIT]);
  yield* log.success(
    `Turned off Omarchy crash notifications ${cliStyler().dim(displayPath(CRASH_CAPTURE_OFF_FLAG))}`,
  );
  entries.push(notable("Turned off Omarchy crash notifications"));

  return entries;
});
