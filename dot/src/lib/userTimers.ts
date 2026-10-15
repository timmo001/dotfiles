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

/** Public timers every machine runs once the systemd package is stowed. */
const DEFAULT_TIMERS = ["dot-notifications-dismiss.timer"];

/** Failure to enable a default timer. */
class UserTimerError extends Schema.TaggedError<UserTimerError>()(
  "UserTimerError",
  { message: Schema.String },
) {}

/**
 * Enable the public timers every machine runs, when their unit is linked and
 * not already enabled.
 *
 * @returns Recap entries for the stow summary. Failures become a warning so a
 *   systemd problem never stops the rest of stow.
 */
export const enableDefaultTimers = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const log = yield* OutputLog;
  let enabled = 0;

  for (const unit of DEFAULT_TIMERS) {
    if (!(yield* pathExists(join(CONFIG_DIR, "systemd", "user", unit))))
      continue;

    if (
      (yield* executor.exitCode("systemctl", [
        "--user",
        "is-enabled",
        "--quiet",
        unit,
      ])) === 0
    )
      continue;

    if (enabled === 0) yield* log.section("User Timers");

    yield* executor.run("systemctl", ["--user", "enable", "--now", unit]).pipe(
      Effect.mapError(
        (cause) =>
          new UserTimerError({
            message:
              cause.stderr || `${cause.command} exited ${cause.exitCode}`,
          }),
      ),
    );

    yield* log.success(`Enabled ${cliStyler().accent(unit)}`);
    enabled++;
  }

  return enabled === 0
    ? [skip("User timers already enabled")]
    : [notable(`Enabled ${plural(enabled, "user timer")}`)];
}).pipe(
  Effect.catch((error) =>
    Effect.gen(function* () {
      const log = yield* OutputLog;

      yield* log.warn(`User timers not enabled: ${error.message}`);

      return [warn("User timers not enabled")] satisfies RecapEntry[];
    }),
  ),
  Effect.withSpan("UserTimers.enableDefaults"),
);
