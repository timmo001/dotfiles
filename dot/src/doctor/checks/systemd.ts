import { Effect } from "effect";
import { accessSync, constants, existsSync, lstatSync, readFileSync } from "fs";
import { join, resolve } from "path";
import {
  CommandExecutor,
  type CommandExecutorService,
} from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import { GitHub } from "../../git/services/GitHub.js";
import { CONFIG_DIR, HOME_DIR, displayPath } from "../../lib/paths.js";
import { ENV, envString } from "../../lib/env.js";
import type { CheckResult } from "../types.js";

// Obsolete workflow notification units that should no longer be installed.
const LEGACY_WORKFLOW_WATCH_SERVICE_UNIT = "git-workflow-watch.service";
const LEGACY_WORKFLOW_WATCH_TIMER_UNIT = "git-workflow-watch.timer";
const DOCTOR_STARTUP_TIMER_UNIT = "dot-doctor-startup.timer";
const DAILY_VOLUME_ZERO_TIMER_UNIT = "daily-volume-zero.timer";
const LOCAL_BIN_DIR = join(HOME_DIR, ".local", "bin");
const UWSM_ENV_FILE = join(CONFIG_DIR, "uwsm", "env");
const RESUME_MONITOR_SERVICE_UNIT = "dot-on-resume-monitor.service";
const DOCTOR_STARTUP_NOTIFY_SCRIPT = join(
  HOME_DIR,
  ".local",
  "bin",
  "dot-doctor-notify",
);
const RESUME_MONITOR_SCRIPT = join(
  HOME_DIR,
  ".local",
  "bin",
  "on-resume-monitor",
);

function userSystemdUnitPath(unit: string): string {
  return join(CONFIG_DIR, "systemd", "user", unit);
}

function pathExistsOrSymlink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function executableExists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function obsoletePathCleanupDetail(
  path: string,
  removalFlag: "-f" | "-rf",
): string {
  return `Remove on this machine after updating dotfiles: rm ${removalFlag} ${displayPath(path)}`;
}

function addObsoletePathCheck(
  results: CheckResult[],
  path: string,
  label: string,
  removalFlag: "-f" | "-rf" = "-f",
): void {
  if (pathExistsOrSymlink(path)) {
    results.push({
      severity: "error",
      message: `Obsolete ${label} still exists: ${displayPath(path)}`,
      detail: obsoletePathCleanupDetail(path, removalFlag),
    });
  } else {
    results.push({
      severity: "ok",
      message: `Obsolete ${label} is absent: ${displayPath(path)}`,
    });
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

const checkObsoleteUserUnit = (
  results: CheckResult[],
  executor: CommandExecutorService,
  unit: string,
) =>
  Effect.gen(function* () {
    const cleanupDetail = `Run on this machine: systemctl --user disable --now ${LEGACY_WORKFLOW_WATCH_TIMER_UNIT} ${LEGACY_WORKFLOW_WATCH_SERVICE_UNIT}; systemctl --user reset-failed ${LEGACY_WORKFLOW_WATCH_TIMER_UNIT} ${LEGACY_WORKFLOW_WATCH_SERVICE_UNIT}; systemctl --user daemon-reload`;
    const enabled = yield* executor.exitCode("systemctl", [
      "--user",
      "is-enabled",
      unit,
    ]);
    if (enabled === 0) {
      results.push({
        severity: "error",
        message: `Obsolete workflow watch unit is still enabled: ${unit}`,
        detail: cleanupDetail,
      });
    } else {
      results.push({
        severity: "ok",
        message: `Obsolete workflow watch unit is not enabled: ${unit}`,
      });
    }

    const active = yield* executor.exitCode("systemctl", [
      "--user",
      "is-active",
      unit,
    ]);
    if (active === 0) {
      results.push({
        severity: "error",
        message: `Obsolete workflow watch unit is still active: ${unit}`,
        detail: cleanupDetail,
      });
    } else {
      results.push({
        severity: "ok",
        message: `Obsolete workflow watch unit is not active: ${unit}`,
      });
    }
  });

/** Check workflow runs integration and absence of the legacy notification watcher. */
export const checkWorkflowRuns = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const config = yield* Config;
  const results: CheckResult[] = [];

  const legacyHooksPath = join(CONFIG_DIR, "git", "workflow-watch-hooks");
  const legacyWatchScript = join(
    HOME_DIR,
    ".local",
    "bin",
    "git-workflow-watch",
  );
  const legacyServiceUnitPath = join(
    CONFIG_DIR,
    "systemd",
    "user",
    LEGACY_WORKFLOW_WATCH_SERVICE_UNIT,
  );
  const legacyTimerUnitPath = join(
    CONFIG_DIR,
    "systemd",
    "user",
    LEGACY_WORKFLOW_WATCH_TIMER_UNIT,
  );

  addObsoletePathCheck(
    results,
    legacyHooksPath,
    "workflow watch hooks path",
    "-rf",
  );
  addObsoletePathCheck(results, legacyWatchScript, "workflow watch script");
  addObsoletePathCheck(
    results,
    legacyServiceUnitPath,
    "workflow watch service unit",
  );
  addObsoletePathCheck(
    results,
    legacyTimerUnitPath,
    "workflow watch timer unit",
  );

  const configuredHooksPath = yield* executor
    .run("git", ["config", "--global", "core.hooksPath"])
    .pipe(Effect.catch(() => Effect.succeed("")));
  const trimmedHooksPath = configuredHooksPath.trim();

  if (
    trimmedHooksPath === legacyHooksPath ||
    trimmedHooksPath === displayPath(legacyHooksPath)
  ) {
    results.push({
      severity: "error",
      message: `Global git hooksPath still points to obsolete workflow watch hooks: ${displayPath(legacyHooksPath)}`,
      detail: "Run on this machine: git config --global --unset core.hooksPath",
    });
  } else if (trimmedHooksPath) {
    results.push({
      severity: "ok",
      message: `Global git hooksPath does not use workflow watch hooks (${displayPath(trimmedHooksPath)})`,
    });
  } else {
    results.push({
      severity: "ok",
      message: "Global git hooksPath is not configured",
    });
  }

  if (!config.canUsePrivate) {
    results.push({
      severity: "warn",
      message: `Skipping workflow config checks (${config.privateReason})`,
    });
  } else if (!config.gitConfig.present) {
    results.push({
      severity: "warn",
      message: config.gitConfig.diagnostics.join("; "),
      detail: "Add dot-git.yml in private dotfiles to enable dot git-workflows",
    });
  } else if (!config.gitConfig.valid) {
    for (const diagnostic of config.gitConfig.diagnostics) {
      results.push({ severity: "error", message: diagnostic });
    }
  } else {
    const workflowCount = config.gitConfig.repositories.filter(
      (repo) => repo.workflows.enabled,
    ).length;
    results.push({
      severity: "ok",
      message: `Workflow git config found: ${displayPath(config.gitConfig.filePath)} (${workflowCount} workflow repos enabled)`,
    });
  }

  const hasSystemctl = (yield* executor.exitCode("which", ["systemctl"])) === 0;
  if (hasSystemctl) {
    yield* checkObsoleteUserUnit(
      results,
      executor,
      LEGACY_WORKFLOW_WATCH_SERVICE_UNIT,
    );
    yield* checkObsoleteUserUnit(
      results,
      executor,
      LEGACY_WORKFLOW_WATCH_TIMER_UNIT,
    );
  } else {
    results.push({
      severity: "warn",
      message:
        "Skipping legacy workflow watch systemd state checks (systemctl not found)",
    });
  }

  return results;
});

/** Check GitHub notifications API access. */
export const checkGitNotifications = Effect.gen(function* () {
  const github = yield* GitHub;
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

/** Check resume recovery monitor service used after hypridle is removed. */
export const checkResumeMonitor = checkRequiredUserUnitSetup({
  scriptPath: RESUME_MONITOR_SCRIPT,
  scriptOkMessage: `Resume monitor script is executable: ${displayPath(RESUME_MONITOR_SCRIPT)}`,
  scriptWarnMessage: `Resume monitor script is missing or not executable: ${displayPath(RESUME_MONITOR_SCRIPT)}`,
  scriptDetail:
    "Run dot stow (or dot install) to link the resume monitor script",
  unitPath: userSystemdUnitPath(RESUME_MONITOR_SERVICE_UNIT),
  unitOkMessage: `Resume monitor service unit file found: ${displayPath(userSystemdUnitPath(RESUME_MONITOR_SERVICE_UNIT))}`,
  unitWarnMessage: `Resume monitor service unit file missing: ${displayPath(userSystemdUnitPath(RESUME_MONITOR_SERVICE_UNIT))}`,
  unitDetail: "Run dot stow (or dot install) to link systemd user units",
  unit: RESUME_MONITOR_SERVICE_UNIT,
  unitLabel: "Resume monitor service",
});

/** Check daily volume reset timer (laptop-only, informational) */
export const checkDailyVolumeReset = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];
  const host = envString(ENV.OMARCHY_HOST) ?? "unset";

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
 * is seeded by ~/.config/uwsm/env (not the login shell). Stowed ~/.local/bin
 * shims only resolve under `uwsm app` when that PATH includes ~/.local/bin.
 */
export const checkLocalBinPath = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  // Durable source: the uwsm env file should add ~/.local/bin to the session PATH.
  if (existsSync(UWSM_ENV_FILE)) {
    const envContent = readFileSync(UWSM_ENV_FILE, "utf-8");
    if (/(\$HOME|~)\/\.local\/bin/.test(envContent)) {
      results.push({
        severity: "ok",
        message: `uwsm env adds ~/.local/bin to PATH: ${displayPath(UWSM_ENV_FILE)}`,
      });
    } else {
      results.push({
        severity: "warn",
        message: `uwsm env does not add ~/.local/bin to PATH: ${displayPath(UWSM_ENV_FILE)}`,
        detail:
          "Add 'export PATH=$HOME/.local/bin:$PATH' to the omarchy-uwsm fork env so uwsm app resolves stowed ~/.local/bin shims",
      });
    }
  } else {
    results.push({
      severity: "warn",
      message: `uwsm env file missing: ${displayPath(UWSM_ENV_FILE)}`,
    });
  }

  // Live session PATH that uwsm app resolves against.
  const hasSystemctl = (yield* executor.exitCode("which", ["systemctl"])) === 0;
  if (!hasSystemctl) {
    results.push({
      severity: "warn",
      message: "Skipping uwsm session PATH check (systemctl not found)",
    });
    return results;
  }

  const showEnvironment = yield* executor
    .run("systemctl", ["--user", "show-environment"])
    .pipe(Effect.catch(() => Effect.succeed("")));
  const onPath = userEnvironmentPathEntries(showEnvironment).some(
    (entry) => resolve(entry) === LOCAL_BIN_DIR,
  );

  if (onPath) {
    results.push({
      severity: "ok",
      message: `~/.local/bin is on the uwsm session PATH: ${displayPath(LOCAL_BIN_DIR)}`,
    });
  } else {
    results.push({
      severity: "warn",
      message: "~/.local/bin is not on the uwsm session PATH",
      detail:
        "Relaunch Hyprland after adding ~/.local/bin to the uwsm env; uwsm app cannot resolve stowed ~/.local/bin shims without it",
    });
  }

  return results;
});
