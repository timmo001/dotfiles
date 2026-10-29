import { join } from "node:path";
import { Effect, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { cliStyler } from "./ansi.js";
import { pathExists } from "./fsProbe.js";
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
  { unit: "dot-notifications-dismiss.timer" },
  // Hokum draws black cards on the desktop's NVIDIA GPU.
  { unit: "hokum.service", onlyHosts: ["laptop"] },
];

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
