import { join } from "node:path";
import { Effect, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { cliStyler } from "./ansi.js";
import { pathExists, readDirectoryOrNull } from "./fsProbe.js";
import { resolvedOmarchyHost } from "./omarchyHost.js";
import { CONFIG_DIR } from "./paths.js";
import { plural } from "./runSummary.js";
import { notable, skip, warn } from "./updateSummary.js";
import type { RecapEntry } from "./updateSummary.js";

/** A user unit dot enables, optionally only on some `OMARCHY_HOST` values. */
interface DefaultUnit {
  /** Unit name, such as `hokum.service`. */
  readonly unit: string;
  /** Hosts that run the unit; omit for every host. */
  readonly onlyHosts?: readonly string[];
}

/**
 * Public user units dot manages once they're installed: stowed timers, and
 * units shipped by packages from the public package list. A unit limited to
 * some hosts is masked on the others, so D-Bus activation can't start it.
 */
const DEFAULT_UNITS: readonly DefaultUnit[] = [
  // Wraps new game shortcuts in gaming mode as launchers write them.
  { unit: "dot-game-sync.path" },
  // Serves the update status to the bar, OpenCode and the CLI.
  { unit: "dot-daemon.service" },
  // Sunshine streams this machine to Moonlight, starting with the desktop.
  { unit: "app-dev.lizardbyte.app.Sunshine.service" },
  // Station's always-on System Bridge, stowed over the package's session unit.
  { unit: "system-bridge.service" },
  // Starts Station's OpenCode server at boot, for Home Assistant's Assist.
  { unit: "opencode-service.service" },
  // Processes queued notes captures; Station is the only machine that does.
  { unit: "notes-capture-daemon.service" },
  // Hokum draws black cards on the desktop's NVIDIA GPU.
  { unit: "hokum.service", onlyHosts: ["laptop"] },
];

/**
 * Units no longer shipped by the shared systemd package. Each one is stopped
 * and disabled before stow removes its retired link, unless a host package
 * ships it, as Station's does for the notes capture daemon.
 */
const RETIRED_UNITS: readonly string[] = ["notes-capture-daemon.service"];

/** Where a default unit can come from: the stowed systemd package or a package. */
const UNIT_DIRS = [
  join(CONFIG_DIR, "systemd", "user"),
  "/usr/lib/systemd/user",
];

/** Failure to enable a default unit. */
class UserUnitError extends Schema.TaggedError<UserUnitError>()(
  "UserUnitError",
  { message: Schema.String },
) {}

/**
 * Enable the public user units every machine runs, when their unit file is
 * installed and not already enabled. Units limited to other hosts are masked.
 *
 * @returns Recap entries for the stow summary. Failures become a warning so a
 *   systemd problem never stops the rest of stow.
 */
export const enableDefaultUnits = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;
  const host = yield* resolvedOmarchyHost(yield* Config);
  let enabled = 0;
  let masked = 0;

  const systemctl = (args: readonly string[]) =>
    executor.run("systemctl", ["--user", ...args]).pipe(
      Effect.mapError(
        (cause) =>
          new UserUnitError({
            message:
              cause.stderr || `${cause.command} exited ${cause.exitCode}`,
          }),
      ),
    );

  for (const { unit, onlyHosts } of DEFAULT_UNITS) {
    let installed = false;

    for (const dir of UNIT_DIRS)
      installed ||= yield* pathExists(join(dir, unit));

    if (!installed) continue;

    if (onlyHosts && !host) continue;

    const state = (yield* systemctl([
      "show",
      "--property=UnitFileState",
      "--value",
      unit,
    ])).trim();

    if (onlyHosts && host && !onlyHosts.includes(host)) {
      if (state === "masked") continue;

      if (enabled + masked === 0) yield* log.section("User Units");

      yield* systemctl(["mask", "--now", unit]);
      yield* log.success(
        `Masked ${cliStyler().accent(unit)} (not used on ${host})`,
      );
      masked++;
      continue;
    }

    if (state === "enabled") continue;

    if (enabled + masked === 0) yield* log.section("User Units");

    if (state === "masked") yield* systemctl(["unmask", unit]);

    yield* systemctl(["enable", "--now", unit]);

    yield* log.success(`Enabled ${cliStyler().accent(unit)}`);
    enabled++;
  }

  if (enabled + masked === 0) return [skip("User units already enabled")];

  return [
    ...(enabled > 0
      ? [notable(`Enabled ${plural(enabled, "user unit")}`)]
      : []),
    ...(masked > 0 ? [notable(`Masked ${plural(masked, "user unit")}`)] : []),
  ];
}).pipe(
  Effect.catch((error) =>
    Effect.gen(function* () {
      const log = yield* OutputLog;

      yield* log.warn(`User units not enabled: ${error.message}`);

      return [warn("User units not enabled")] satisfies RecapEntry[];
    }),
  ),
  Effect.withSpan("UserUnits.enableDefaults"),
);

/**
 * Stop and disable retired units still enabled or running here, while their
 * stowed link can still be found. Runs before stow removes retired links.
 *
 * @returns Recap entries for the stow summary, empty when nothing was
 *   retired. Failures become a warning so stow carries on.
 */
export const disableRetiredUnits = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;
  const packages = (yield* readDirectoryOrNull(config.publicDotfiles)) ?? [];
  let disabled = 0;

  const systemctl = (args: readonly string[]) =>
    executor.run("systemctl", ["--user", ...args]).pipe(
      Effect.mapError(
        (cause) =>
          new UserUnitError({
            message:
              cause.stderr || `${cause.command} exited ${cause.exitCode}`,
          }),
      ),
    );

  const property = (unit: string, name: string) =>
    systemctl(["show", `--property=${name}`, "--value", unit]).pipe(
      Effect.map((value) => value.trim()),
    );

  for (const unit of RETIRED_UNITS) {
    let shipped = false;

    for (const name of packages)
      shipped ||= yield* pathExists(
        join(config.publicDotfiles, name, ".config", "systemd", "user", unit),
      );

    if (shipped) continue;

    const state = yield* property(unit, "UnitFileState");
    const active = yield* property(unit, "ActiveState");
    const enabled = state === "enabled" || state === "linked";
    const running = active !== "inactive" && active !== "failed";

    if (!enabled && !running) continue;

    if (disabled === 0) yield* log.section("Retired User Units");

    // Stop before disable, which reloads systemd and drops the unit's settings
    // (such as SuccessExitStatus) once its source is gone, failing the stop.
    if (running) yield* systemctl(["stop", unit]);

    if (enabled) yield* systemctl(["disable", unit]);

    yield* systemctl(["reset-failed", unit]).pipe(Effect.ignore);
    yield* log.success(`Stopped and disabled ${cliStyler().accent(unit)}`);
    disabled++;
  }

  if (disabled === 0) return [];

  return [
    notable(`Stopped and disabled ${plural(disabled, "retired user unit")}`),
  ] satisfies RecapEntry[];
}).pipe(
  Effect.catch((error) =>
    Effect.gen(function* () {
      const log = yield* OutputLog;

      yield* log.warn(`Retired user units not disabled: ${error.message}`);

      return [warn("Retired user units not disabled")] satisfies RecapEntry[];
    }),
  ),
  Effect.withSpan("UserUnits.disableRetired"),
);
