import { Effect } from "effect";
import { accessSync, constants, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import {
  CommandExecutor,
  type CommandExecutorService,
} from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import type { ConfigService } from "../../services/Config.js";
import { GitHub } from "../../git/services/GitHub.js";
import { CONFIG_DIR, HOME_DIR, displayPath } from "../../lib/paths.js";
import { resolvedOmarchyHost } from "../../lib/omarchyHost.js";
import type { CheckResult } from "../types.js";

const DOCTOR_STARTUP_TIMER_UNIT = "dot-doctor-startup.timer";
const DAILY_VOLUME_ZERO_TIMER_UNIT = "daily-volume-zero.timer";
const LOCAL_BIN_DIR = join(HOME_DIR, ".local", "bin");
const RELOAD_UI_MONITOR_SERVICE_UNIT = "dot-reload-ui-monitor.service";
const DOCTOR_STARTUP_NOTIFY_SCRIPT = join(
  HOME_DIR,
  ".local",
  "bin",
  "dot-doctor-notify",
);
const RELOAD_UI_MONITOR_SCRIPT = join(
  HOME_DIR,
  ".local",
  "bin",
  "reload-ui-monitor",
);

function userSystemdUnitPath(unit: string): string {
  return join(CONFIG_DIR, "systemd", "user", unit);
}

function executableExists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function addExecutablePresenceCheck(
  results: CheckResult[],
  path: string,
  okMessage: string,
  warnMessage: string,
  detail?: string,
): void {
  results.push(
    executableExists(path)
      ? { severity: "ok", message: okMessage }
      : {
          severity: "warn",
          message: warnMessage,
          ...(detail && { detail }),
        },
  );
}

function addFilePresenceCheck(
  results: CheckResult[],
  path: string,
  okMessage: string,
  warnMessage: string,
  detail: string,
): void {
  results.push(
    existsSync(path)
      ? { severity: "ok", message: okMessage }
      : { severity: "warn", message: warnMessage, detail },
  );
}

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
  readonly scriptPath: string;
  readonly scriptOkMessage: string;
  readonly scriptWarnMessage: string;
  readonly scriptDetail?: string;
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

    addExecutablePresenceCheck(
      results,
      setup.scriptPath,
      setup.scriptOkMessage,
      setup.scriptWarnMessage,
      setup.scriptDetail,
    );
    addFilePresenceCheck(
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
  const config = yield* Config;
  const results: CheckResult[] = [];

  const hasGh = yield* github.isAvailable();
  if (!hasGh) {
    results.push({
      severity: "warn",
      message: "Skipping GitHub notifications API check (gh CLI not found)",
    });
  } else {
    const notificationsAccess = yield* github
      .api("notifications?per_page=1")
      .pipe(
        Effect.map(() => true),
        Effect.catch(() => Effect.succeed(false)),
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

/** Check doctor startup notification timer */
export const checkDoctorStartup = checkRequiredUserUnitSetup({
  scriptPath: DOCTOR_STARTUP_NOTIFY_SCRIPT,
  scriptOkMessage: `Doctor startup notify script found: ${displayPath(DOCTOR_STARTUP_NOTIFY_SCRIPT)}`,
  scriptWarnMessage: `Doctor startup notify script missing or not executable: ${displayPath(DOCTOR_STARTUP_NOTIFY_SCRIPT)}`,
  unitPath: userSystemdUnitPath(DOCTOR_STARTUP_TIMER_UNIT),
  unitOkMessage: `Doctor startup timer unit file found: ${displayPath(userSystemdUnitPath(DOCTOR_STARTUP_TIMER_UNIT))}`,
  unitWarnMessage: `Doctor startup timer unit file missing: ${displayPath(userSystemdUnitPath(DOCTOR_STARTUP_TIMER_UNIT))}`,
  unitDetail: "Run dot stow (or dot install) to link systemd user units",
  unit: DOCTOR_STARTUP_TIMER_UNIT,
  unitLabel: "Doctor startup timer",
});

/** Check the UI reload monitor service used after hypridle is removed. */
export const checkReloadUiMonitor = checkRequiredUserUnitSetup({
  scriptPath: RELOAD_UI_MONITOR_SCRIPT,
  scriptOkMessage: `Reload UI monitor script is executable: ${displayPath(RELOAD_UI_MONITOR_SCRIPT)}`,
  scriptWarnMessage: `Reload UI monitor script is missing or not executable: ${displayPath(RELOAD_UI_MONITOR_SCRIPT)}`,
  scriptDetail:
    "Run dot stow (or dot install) to link the reload UI monitor script",
  unitPath: userSystemdUnitPath(RELOAD_UI_MONITOR_SERVICE_UNIT),
  unitOkMessage: `Reload UI monitor service unit file found: ${displayPath(userSystemdUnitPath(RELOAD_UI_MONITOR_SERVICE_UNIT))}`,
  unitWarnMessage: `Reload UI monitor service unit file missing: ${displayPath(userSystemdUnitPath(RELOAD_UI_MONITOR_SERVICE_UNIT))}`,
  unitDetail: "Run dot stow (or dot install) to link systemd user units",
  unit: RELOAD_UI_MONITOR_SERVICE_UNIT,
  unitLabel: "Reload UI monitor service",
});

/** Check daily volume reset timer (laptop-only, informational) */
export const checkDailyVolumeReset = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];
  const host = resolvedOmarchyHost(config) ?? "unset";

  const script = join(HOME_DIR, ".local", "bin", "daily-volume-zero");
  const serviceUnit = userSystemdUnitPath("daily-volume-zero.service");
  const timerUnit = userSystemdUnitPath(DAILY_VOLUME_ZERO_TIMER_UNIT);

  if (existsSync(script)) {
    results.push({
      severity: "ok",
      message: `Daily volume reset script found: ${displayPath(script)}`,
    });
  } else {
    results.push({
      severity: "ok",
      message: `Daily volume reset script missing or not executable: ${displayPath(script)}`,
    });
  }

  if (existsSync(serviceUnit)) {
    results.push({
      severity: "ok",
      message: `Daily volume reset service unit file found: ${displayPath(serviceUnit)}`,
    });
  } else {
    const detail =
      host === "laptop"
        ? "Run dot stow (or dot install) to link systemd user units if you want this optional timer"
        : `Daily volume reset is laptop-only; not linking it for OMARCHY_HOST=${host}`;
    results.push({
      severity: "ok",
      message: `Daily volume reset service unit file missing: ${displayPath(serviceUnit)}`,
      detail,
    });
  }

  if (existsSync(timerUnit)) {
    results.push({
      severity: "ok",
      message: `Daily volume reset timer unit file found: ${displayPath(timerUnit)}`,
    });
  } else {
    const detail =
      host === "laptop"
        ? "Run dot stow (or dot install) to link systemd user units if you want this optional timer"
        : `Daily volume reset is laptop-only; not linking it for OMARCHY_HOST=${host}`;
    results.push({
      severity: "ok",
      message: `Daily volume reset timer unit file missing: ${displayPath(timerUnit)}`,
      detail,
    });
  }

  const hasSystemctl = (yield* executor.exitCode("which", ["systemctl"])) === 0;
  if (hasSystemctl) {
    const enabled = yield* executor.exitCode("systemctl", [
      "--user",
      "is-enabled",
      DAILY_VOLUME_ZERO_TIMER_UNIT,
    ]);
    if (enabled === 0) {
      results.push({
        severity: "ok",
        message: `Daily volume reset timer enabled: ${DAILY_VOLUME_ZERO_TIMER_UNIT}`,
      });
    } else {
      const detail =
        host === "laptop"
          ? `Enable with: systemctl --user enable --now ${DAILY_VOLUME_ZERO_TIMER_UNIT}`
          : `Daily volume reset is laptop-only; leave it disabled for OMARCHY_HOST=${host}`;
      results.push({
        severity: "ok",
        message: `Daily volume reset timer is disabled: ${DAILY_VOLUME_ZERO_TIMER_UNIT}`,
        detail,
      });
    }

    const active = yield* executor.exitCode("systemctl", [
      "--user",
      "is-active",
      DAILY_VOLUME_ZERO_TIMER_UNIT,
    ]);
    if (active === 0) {
      results.push({
        severity: "ok",
        message: `Daily volume reset timer active: ${DAILY_VOLUME_ZERO_TIMER_UNIT}`,
      });
    } else {
      results.push({
        severity: "ok",
        message: `Daily volume reset timer is not active: ${DAILY_VOLUME_ZERO_TIMER_UNIT}`,
      });
    }
  } else {
    results.push({
      severity: "ok",
      message: "Skipping daily volume reset timer checks (systemctl not found)",
    });
  }

  return results;
});

/** Extract the colon-separated PATH entries from `systemctl --user show-environment` output. */
function userEnvironmentPathEntries(
  showEnvironment: string,
): readonly string[] {
  const pathLine = showEnvironment
    .split("\n")
    .find((line) => line.startsWith("PATH="));
  if (!pathLine) return [];
  return pathLine.slice("PATH=".length).split(":").filter(Boolean);
}

/**
 * Check that ~/.local/bin is on the uwsm/systemd user-environment PATH.
 *
 * `uwsm app` resolves binaries against the systemd user-environment PATH, which
 * is seeded by Omarchy's package-owned UWSM bootstrap (not the login shell).
 * Stowed ~/.local/bin shims only resolve when that PATH includes ~/.local/bin.
 */
export const checkLocalBinPath = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const hasSystemctl = (yield* executor.exitCode("which", ["systemctl"])) === 0;
  if (!hasSystemctl) {
    return [
      {
        severity: "warn",
        message: "Skipping uwsm session PATH check (systemctl not found)",
      },
    ] satisfies CheckResult[];
  }

  const showEnvironment = yield* executor
    .run("systemctl", ["--user", "show-environment"])
    .pipe(Effect.catch(() => Effect.succeed("")));
  const onPath = userEnvironmentPathEntries(showEnvironment).some(
    (entry) => resolve(entry) === LOCAL_BIN_DIR,
  );

  if (onPath) {
    return [
      {
        severity: "ok",
        message: `~/.local/bin is on the uwsm session PATH: ${displayPath(LOCAL_BIN_DIR)}`,
      },
    ] satisfies CheckResult[];
  }

  return [
    {
      severity: "warn",
      message: "~/.local/bin is not on the uwsm session PATH",
      detail:
        "Relaunch Hyprland so the package-owned Omarchy UWSM bootstrap refreshes the session environment",
    },
  ] satisfies CheckResult[];
});
