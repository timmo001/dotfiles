import { Effect } from "effect";
import { accessSync, constants, existsSync, lstatSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
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

// ---------------------------------------------------------------------------
// Waybar config walk helpers (matches legacy _waybar_config_walk pattern)
// ---------------------------------------------------------------------------

/** Walk a Waybar config and its includes, returning true if any file contains the needle */
function waybarConfigWalkContains(configPath: string, needle: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const content = readFileSync(configPath, "utf-8");
    if (content.includes(needle)) return true;
    // Check includes
    for (const includePath of parseWaybarIncludes(configPath, content)) {
      if (waybarConfigWalkContains(includePath, needle)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Parse "include" array entries from a Waybar JSONC config file */
function parseWaybarIncludes(
  configPath: string,
  content: string,
): readonly string[] {
  const match = content.match(/"include"\s*:\s*\[([^\]]*)\]/);
  if (!match) return [];
  const configDir = dirname(configPath);
  return match[1]
    .split(",")
    .map((e) => e.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
    .map((e) => {
      const expanded = e.replace(/^~/, HOME_DIR);
      return expanded.startsWith("/") ? expanded : join(configDir, expanded);
    });
}

function activeWaybarConfigPath(): string {
  const omarchyHost = envString(ENV.OMARCHY_HOST) ?? "";
  const waybarConfigDir = join(CONFIG_DIR, "waybar");
  const hostConfig = omarchyHost
    ? join(waybarConfigDir, `config.${omarchyHost}.jsonc`)
    : "";
  return hostConfig && existsSync(hostConfig)
    ? hostConfig
    : join(waybarConfigDir, "config.jsonc");
}

function addWaybarScriptCheck(
  results: CheckResult[],
  scriptName: string,
  label: string,
  missingDetail: string,
): void {
  const waybarScript = join(CONFIG_DIR, "waybar", "scripts", scriptName);
  results.push(
    executableExists(waybarScript)
      ? {
          severity: "ok",
          message: `${label} Waybar script is executable: ${displayPath(waybarScript)}`,
        }
      : {
          severity: "warn",
          message: `${label} Waybar script is missing or not executable: ${displayPath(waybarScript)}`,
          detail: missingDetail,
        },
  );
}

function addWaybarHiddenCssCheck(
  results: CheckResult[],
  selector: string,
  label: string,
  missingDetail: string,
): void {
  const waybarStyle = join(CONFIG_DIR, "waybar", "style.css");
  if (!existsSync(waybarStyle)) {
    results.push({
      severity: "warn",
      message: `Waybar style file is missing: ${displayPath(waybarStyle)}`,
    });
    return;
  }

  try {
    const styleContent = readFileSync(waybarStyle, "utf-8");
    results.push(
      styleContent.includes(selector)
        ? {
            severity: "ok",
            message: `${label} Waybar hidden-empty CSS found: ${displayPath(waybarStyle)}`,
          }
        : {
            severity: "warn",
            message: `${label} Waybar hidden-empty CSS is missing: ${displayPath(waybarStyle)}`,
            detail: missingDetail,
          },
    );
  } catch {
    /* ignore */
  }
}

function addWaybarConfigContainsCheck(
  results: CheckResult[],
  waybarConfig: string,
  needle: string,
  okMessage: string,
  warnMessage: string,
  detail?: string,
): void {
  if (waybarConfigWalkContains(waybarConfig, needle)) {
    results.push({ severity: "ok", message: okMessage });
  } else {
    results.push({
      severity: "warn",
      message: warnMessage,
      ...(detail && { detail }),
    });
  }
}

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

  addWaybarScriptCheck(
    results,
    "git-workflows-waybar.sh",
    "Workflow runs",
    "Stow or update the Waybar repo to install the workflow runs module script",
  );
  addWaybarHiddenCssCheck(
    results,
    "#custom-git-workflows.hidden",
    "Workflow runs",
    "Update the Waybar style so the workflow icon hides when there are no recent runs needing attention",
  );

  const waybarConfig = activeWaybarConfigPath();

  if (existsSync(waybarConfig)) {
    results.push({
      severity: "ok",
      message: `Workflow runs active Waybar config: ${displayPath(waybarConfig)}`,
    });

    // Walk config and includes to check for module, click actions, and ordering
    const configContains = (needle: string): boolean =>
      waybarConfigWalkContains(waybarConfig, needle);

    if (configContains("git-workflow-watch")) {
      results.push({
        severity: "error",
        message: `Active Waybar config still references obsolete git-workflow-watch: ${displayPath(waybarConfig)}`,
        detail:
          "Update/re-stow the Waybar config on this machine, or remove the legacy git-workflow-watch module/action references from the active Waybar config",
      });
    } else {
      results.push({
        severity: "ok",
        message: "Active Waybar config has no legacy workflow-watch actions",
      });
    }
  } else {
    results.push({
      severity: "warn",
      message: `Active Waybar config is missing: ${displayPath(waybarConfig)}`,
    });
  }

  return results;
});

/** Check GitHub notifications API access and Waybar integration. */
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

  addWaybarScriptCheck(
    results,
    "git-notifications-waybar.sh",
    "Git notifications",
    "Stow or update the Waybar repo to install the Git notifications module script",
  );
  addWaybarHiddenCssCheck(
    results,
    "#custom-git-notifications.hidden",
    "Git notifications",
    "Update the Waybar style so the notification icon hides when the inbox is clear",
  );

  const waybarConfig = activeWaybarConfigPath();

  if (existsSync(waybarConfig)) {
    results.push({
      severity: "ok",
      message: `Git notifications active Waybar config: ${displayPath(waybarConfig)}`,
    });

    addWaybarConfigContainsCheck(
      results,
      waybarConfig,
      '"custom/git-notifications"',
      "Git notifications Waybar module is present in the active config",
      `Git notifications Waybar module is missing from ${displayPath(waybarConfig)}`,
      "Add custom/git-notifications before custom/git-diff in the active Waybar config",
    );
    addWaybarConfigContainsCheck(
      results,
      waybarConfig,
      '"on-click": "~/.config/waybar/scripts/git-notifications-waybar.sh open"',
      "Git notifications Waybar left click opens the filtered TUI",
      `Git notifications Waybar left-click action is missing in ${displayPath(waybarConfig)}`,
    );
    addWaybarConfigContainsCheck(
      results,
      waybarConfig,
      '"on-click-right": "~/.config/waybar/scripts/git-notifications-waybar.sh refresh"',
      "Git notifications Waybar right click refreshes the cache",
      `Git notifications Waybar right-click refresh action is missing in ${displayPath(waybarConfig)}`,
    );
  } else {
    results.push({
      severity: "warn",
      message: `Active Waybar config is missing: ${displayPath(waybarConfig)}`,
    });
  }

  return results;
});

/** Check doctor startup notification timer */
export const checkDoctorStartup = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  const notifyScript = join(HOME_DIR, ".local", "bin", "dot-doctor-notify");
  const unitPath = join(
    CONFIG_DIR,
    "systemd",
    "user",
    DOCTOR_STARTUP_TIMER_UNIT,
  );

  if (existsSync(notifyScript)) {
    results.push({
      severity: "ok",
      message: `Doctor startup notify script found: ${displayPath(notifyScript)}`,
    });
  } else {
    results.push({
      severity: "warn",
      message: `Doctor startup notify script missing or not executable: ${displayPath(notifyScript)}`,
    });
  }

  if (existsSync(unitPath)) {
    results.push({
      severity: "ok",
      message: `Doctor startup timer unit file found: ${displayPath(unitPath)}`,
    });
  } else {
    results.push({
      severity: "warn",
      message: `Doctor startup timer unit file missing: ${displayPath(unitPath)}`,
      detail: "Run dot stow (or dot install) to link systemd user units",
    });
  }

  const hasSystemctl = (yield* executor.exitCode("which", ["systemctl"])) === 0;
  if (hasSystemctl) {
    const enabled = yield* executor.exitCode("systemctl", [
      "--user",
      "is-enabled",
      DOCTOR_STARTUP_TIMER_UNIT,
    ]);
    if (enabled === 0) {
      results.push({
        severity: "ok",
        message: `Doctor startup timer enabled: ${DOCTOR_STARTUP_TIMER_UNIT}`,
      });
    } else {
      results.push({
        severity: "warn",
        message: `Doctor startup timer is disabled: ${DOCTOR_STARTUP_TIMER_UNIT}`,
        detail: `Enable with: systemctl --user enable --now ${DOCTOR_STARTUP_TIMER_UNIT}`,
      });
    }

    const active = yield* executor.exitCode("systemctl", [
      "--user",
      "is-active",
      DOCTOR_STARTUP_TIMER_UNIT,
    ]);
    if (active === 0) {
      results.push({
        severity: "ok",
        message: `Doctor startup timer active: ${DOCTOR_STARTUP_TIMER_UNIT}`,
      });
    } else {
      results.push({
        severity: "warn",
        message: `Doctor startup timer is not active: ${DOCTOR_STARTUP_TIMER_UNIT}`,
      });
    }
  } else {
    results.push({
      severity: "warn",
      message: "Skipping doctor startup timer checks (systemctl not found)",
    });
  }

  return results;
});

/** Check daily volume reset timer (laptop-only, informational) */
export const checkDailyVolumeReset = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];
  const host = envString(ENV.OMARCHY_HOST) ?? "unset";

  const script = join(HOME_DIR, ".local", "bin", "daily-volume-zero");
  const systemdDir = join(CONFIG_DIR, "systemd", "user");
  const serviceUnit = join(systemdDir, "daily-volume-zero.service");
  const timerUnit = join(systemdDir, DAILY_VOLUME_ZERO_TIMER_UNIT);

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
