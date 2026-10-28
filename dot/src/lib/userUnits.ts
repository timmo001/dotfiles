import { join } from "node:path";
import { Effect, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { cliStyler } from "./ansi.js";
import { pathExists } from "./fsProbe.js";
import { CONFIG_DIR } from "./paths.js";
import { plural } from "./runSummary.js";
import { notable, skip, warn } from "./updateSummary.js";
import type { RecapEntry } from "./updateSummary.js";

/**
 * Public user units every machine runs once they're installed: stowed timers,
 * and units shipped by packages from the public package list.
 */
const DEFAULT_UNITS = ["dot-notifications-dismiss.timer", "hokum.service"];

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
 * installed and not already enabled.
 *
 * @returns Recap entries for the stow summary. Failures become a warning so a
 *   systemd problem never stops the rest of stow.
 */
export const enableDefaultUnits = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;
  let enabled = 0;

  for (const unit of DEFAULT_UNITS) {
    let installed = false;

    for (const dir of UNIT_DIRS)
      installed ||= yield* pathExists(join(dir, unit));

    if (!installed) continue;

    if (
      (yield* executor.exitCode("systemctl", [
        "--user",
        "is-enabled",
        "--quiet",
        unit,
      ])) === 0
    )
      continue;

    if (enabled === 0) yield* log.section("User Units");

    yield* executor.run("systemctl", ["--user", "enable", "--now", unit]).pipe(
      Effect.mapError(
        (cause) =>
          new UserUnitError({
            message:
              cause.stderr || `${cause.command} exited ${cause.exitCode}`,
          }),
      ),
    );

    yield* log.success(`Enabled ${cliStyler().accent(unit)}`);
    enabled++;
  }

  return enabled === 0
    ? [skip("User units already enabled")]
    : [notable(`Enabled ${plural(enabled, "user unit")}`)];
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
