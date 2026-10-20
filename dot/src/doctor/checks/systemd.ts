import { NodeFileSystem } from "@effect/platform-node";
import { Api } from "@timmo001/effect-gh";
import { Effect } from "effect";
import { join } from "path";
import {
  CommandExecutor,
  type CommandExecutorService,
} from "../../services/CommandExecutor.js";
import { GitHub } from "../../git/services/GitHub.js";
import { pathExists } from "../../lib/fsProbe.js";
import { CONFIG_DIR, displayPath } from "../../lib/paths.js";
import {
  collectServiceStatus,
  readRegisteredServices,
} from "../../commands/Services.js";
import type { CheckResult } from "../types.js";

const DOCTOR_TIMER_UNIT = "dot-doctor.timer";

function userSystemdUnitPath(unit: string): string {
  return join(CONFIG_DIR, "systemd", "user", unit);
}

const addFilePresenceCheck = Effect.fn("Systemd.addFileCheck")(function* (
  results: CheckResult[],
  path: string,
  okMessage: string,
  warnMessage: string,
  detail: string,
) {
  results.push(
    (yield* pathExists(path))
      ? { severity: "ok", message: okMessage }
      : { severity: "warn", message: warnMessage, detail },
  );
});

const checkRequiredUserUnit = (
  results: CheckResult[],
  executor: CommandExecutorService,
  unit: string,
  label: string,
  enableDetail: string,
) =>
  Effect.gen(function* () {
    const hasSystemctl =
      (yield* executor.exitCode("which", ["systemctl"])) === 0;

    if (!hasSystemctl) {
      results.push({
        severity: "warn",
        message: `Skipping ${label.toLowerCase()} checks (systemctl not found)`,
      });

      return;
    }

    const enabled = yield* executor.exitCode("systemctl", [
      "--user",
      "is-enabled",
      unit,
    ]);

    if (enabled === 0) {
      results.push({ severity: "ok", message: `${label} enabled: ${unit}` });
    } else {
      results.push({
        severity: "warn",
        message: `${label} is disabled: ${unit}`,
        detail: enableDetail,
      });
    }

    const active = yield* executor.exitCode("systemctl", [
      "--user",
      "is-active",
      unit,
    ]);

    if (active === 0) {
      results.push({ severity: "ok", message: `${label} active: ${unit}` });
    } else {
      results.push({
        severity: "warn",
        message: `${label} is not active: ${unit}`,
        detail: enableDetail,
      });
    }
  });

interface RequiredUserUnitSetup {
  readonly unitPath: string;
  readonly unitOkMessage: string;
  readonly unitWarnMessage: string;
  readonly unitDetail: string;
  readonly unit: string;
  readonly unitLabel: string;
}

const checkRequiredUserUnitSetup = (setup: RequiredUserUnitSetup) =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const results: CheckResult[] = [];
    const enableDetail = `Enable with: systemctl --user enable --now ${setup.unit}`;

    yield* addFilePresenceCheck(
      results,
      setup.unitPath,
      setup.unitOkMessage,
      setup.unitWarnMessage,
      setup.unitDetail,
    );
    yield* checkRequiredUserUnit(
      results,
      executor,
      setup.unit,
      setup.unitLabel,
      enableDetail,
    );

    return results;
  });

/** Check GitHub notifications API access. */
export const checkGitNotifications = Effect.gen(function* () {
  const github = yield* GitHub;
  const results: CheckResult[] = [];

  const hasGh = yield* github.isAvailable;

  if (!hasGh) {
    results.push({
      severity: "warn",
      message: "Skipping GitHub notifications API check (gh CLI not found)",
    });
  } else {
    const notificationsAccess = yield* github
      .read(
        "notifications",
        Api.empty({
          endpoint: "notifications",
          method: "GET",
          query: { per_page: 1 },
        }),
      )
      .pipe(
        Effect.map(() => true),
        Effect.orElseSucceed(() => false),
      );

    if (notificationsAccess) {
      results.push({
        severity: "ok",
        message: "GitHub notifications API is accessible",
      });
    } else {
      results.push({
        severity: "warn",
        message: "GitHub notifications API is not accessible",
        detail:
          "Authenticate gh with a classic token that has notifications or repo scope",
      });
    }
  }

  return results;
});

/** Check the doctor timer */
export const checkDoctorTimer = checkRequiredUserUnitSetup({
  unitPath: userSystemdUnitPath(DOCTOR_TIMER_UNIT),
  unitOkMessage: `Doctor timer unit file found: ${displayPath(userSystemdUnitPath(DOCTOR_TIMER_UNIT))}`,
  unitWarnMessage: `Doctor timer unit file missing: ${displayPath(userSystemdUnitPath(DOCTOR_TIMER_UNIT))}`,
  unitDetail: "Run dot stow (or dot install) to link systemd user units",
  unit: DOCTOR_TIMER_UNIT,
  unitLabel: "Doctor timer",
});

/** Report registered services whose monitoring policy says they need attention. */
export const checkRegisteredServices = Effect.gen(function* () {
  const { registered, errors } = yield* readRegisteredServices;

  const results: CheckResult[] = errors.map(({ file, message }) => ({
    severity: "warn",
    message: `Invalid service descriptor: ${displayPath(file)}`,
    detail: message,
  }));

  for (const status of yield* collectServiceStatus(registered))
    results.push(
      status.health === "failed" ||
        status.health === "stale" ||
        status.health === "warning"
        ? {
            severity: "warn",
            message: `${status.label} is ${status.health}: ${status.summary}`,
            detail: `Inspect with: dot services logs ${status.unit}`,
          }
        : {
            severity: "ok",
            message: `${status.label}: ${status.summary}`,
          },
    );

  return results;
}).pipe(Effect.provide(NodeFileSystem.layer));
