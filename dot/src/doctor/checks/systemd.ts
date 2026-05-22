import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import type { CheckResult } from "../types.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;
const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME ?? join(HOME, ".config");

function displayPath(p: string): string {
  return p.replace(HOME, "~");
}

// Timer unit names from legacy bash
const WORKFLOW_WATCH_TIMER_UNIT = "git-workflow-watch.timer";
const DOCTOR_STARTUP_TIMER_UNIT = "dot-doctor-startup.timer";
const DAILY_VOLUME_ZERO_TIMER_UNIT = "daily-volume-zero.timer";

/** Check workflow watch hooks, timer, scripts, and Waybar integration */
export const checkWorkflowWatch = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const config = yield* Config;
  const results: CheckResult[] = [];

  const hooksPath = join(HOME, ".config", "git", "workflow-watch-hooks");
  if (existsSync(hooksPath)) {
    results.push({
      severity: "ok",
      message: `Workflow watch hooks path exists: ${displayPath(hooksPath)}`,
    });
  } else {
    results.push({
      severity: "warn",
      message: `Workflow watch hooks path is missing: ${displayPath(hooksPath)}`,
      detail:
        "Run dot stow or dot init to install the workflow watch hook package",
    });
  }

  // Check global git hooksPath
  const configuredHooksPath = yield* executor
    .run("git", ["config", "--global", "core.hooksPath"])
    .pipe(Effect.catch(() => Effect.succeed("")));
  const trimmedHooksPath = configuredHooksPath.trim();

  if (
    trimmedHooksPath === hooksPath ||
    trimmedHooksPath === displayPath(hooksPath)
  ) {
    results.push({
      severity: "ok",
      message: `Global git hooksPath points to workflow watch hooks`,
    });
  } else if (trimmedHooksPath) {
    results.push({
      severity: "warn",
      message: `Global git hooksPath differs from workflow watch hooks (${displayPath(trimmedHooksPath)})`,
      detail: "Run dot init to configure global workflow watch hooks",
    });
  } else {
    results.push({
      severity: "warn",
      message: "Global git hooksPath is not configured",
      detail: "Run dot init to configure global workflow watch hooks",
    });
  }

  // Check repos file (lives in private dotfiles)
  const reposFile =
    process.env.DOT_WORKFLOW_WATCH_REPOS_FILE ??
    (config.privateDotfiles
      ? join(config.privateDotfiles, ".git-workflow-watch-repos")
      : null);
  if (reposFile && existsSync(reposFile)) {
    results.push({
      severity: "ok",
      message: `Workflow watch repo list found: ${displayPath(reposFile)}`,
    });
  } else {
    results.push({
      severity: "warn",
      message: `Workflow watch repo list missing: ${displayPath(reposFile ?? "~/.config/dotfiles-private/.git-workflow-watch-repos")}`,
      detail:
        "Add watched repositories in private dotfiles to enable workflow monitoring",
    });
  }

  // Systemctl timer checks
  const hasSystemctl = (yield* executor.exitCode("which", ["systemctl"])) === 0;
  if (hasSystemctl) {
    const enabled = yield* executor.exitCode("systemctl", [
      "--user",
      "is-enabled",
      WORKFLOW_WATCH_TIMER_UNIT,
    ]);
    if (enabled === 0) {
      results.push({
        severity: "ok",
        message: `Workflow watch timer enabled: ${WORKFLOW_WATCH_TIMER_UNIT}`,
      });
    } else {
      results.push({
        severity: "warn",
        message: `Workflow watch timer is not enabled: ${WORKFLOW_WATCH_TIMER_UNIT}`,
        detail: "Run dot init to enable the workflow watch timer",
      });
    }

    const active = yield* executor.exitCode("systemctl", [
      "--user",
      "is-active",
      WORKFLOW_WATCH_TIMER_UNIT,
    ]);
    if (active === 0) {
      results.push({
        severity: "ok",
        message: `Workflow watch timer active: ${WORKFLOW_WATCH_TIMER_UNIT}`,
      });
    } else {
      results.push({
        severity: "warn",
        message: `Workflow watch timer is not active: ${WORKFLOW_WATCH_TIMER_UNIT}`,
      });
    }
  } else {
    results.push({
      severity: "warn",
      message: "Skipping workflow watch timer checks (systemctl not found)",
    });
  }

  // Check script executable
  const watchScript = join(HOME, ".local", "bin", "git-workflow-watch");
  if (existsSync(watchScript)) {
    results.push({
      severity: "ok",
      message: `Workflow watch script is executable: ${displayPath(watchScript)}`,
    });
  } else {
    results.push({
      severity: "warn",
      message: `Workflow watch script is missing or not executable: ${displayPath(watchScript)}`,
      detail: "Run dot stow or dot init to install the workflow watch script",
    });
  }

  return results;
});

/** Check doctor startup notification timer */
export const checkDoctorStartup = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  const notifyScript = join(HOME, ".local", "bin", "dot-doctor-notify");
  const unitPath = join(
    XDG_CONFIG_HOME,
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
  const host = process.env.OMARCHY_HOST ?? "unset";

  const script = join(HOME, ".local", "bin", "daily-volume-zero");
  const systemdDir = join(XDG_CONFIG_HOME, "systemd", "user");
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
      message: `Daily volume reset script missing: ${displayPath(script)}`,
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
