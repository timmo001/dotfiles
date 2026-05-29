import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
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

/** Walk a Waybar config and its includes, checking if `first` appears before `second` */
function waybarConfigWalkOrdersBefore(
  configPath: string,
  first: string,
  second: string,
): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const content = readFileSync(configPath, "utf-8");
    const flat = content.replace(/[\n\r]/g, "");
    const re = new RegExp(
      escapeRegex(first) + "\\s*,\\s*" + escapeRegex(second),
    );
    if (re.test(flat)) return true;
    for (const includePath of parseWaybarIncludes(configPath, content)) {
      if (waybarConfigWalkOrdersBefore(includePath, first, second)) return true;
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
      const expanded = e.replace(/^~/, HOME);
      return expanded.startsWith("/") ? expanded : join(configDir, expanded);
    });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
      message: `Global git hooksPath points to workflow watch hooks: ${displayPath(hooksPath)}`,
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

  // Waybar script
  const waybarScript = join(
    XDG_CONFIG_HOME,
    "waybar",
    "scripts",
    "github-workflows-waybar.sh",
  );
  if (existsSync(waybarScript)) {
    results.push({
      severity: "ok",
      message: `Workflow runs Waybar script is executable: ${displayPath(waybarScript)}`,
    });
  } else {
    results.push({
      severity: "warn",
      message: `Workflow runs Waybar script is missing or not executable: ${displayPath(waybarScript)}`,
      detail:
        "Stow or update the Waybar repo to install the workflow runs module script",
    });
  }

  // Waybar style CSS hidden-empty
  const waybarStyle = join(XDG_CONFIG_HOME, "waybar", "style.css");
  if (existsSync(waybarStyle)) {
    try {
      const styleContent = readFileSync(waybarStyle, "utf-8");
      if (styleContent.includes("#custom-github-workflows.hidden")) {
        results.push({
          severity: "ok",
          message: `Workflow runs Waybar hidden-empty CSS found: ${displayPath(waybarStyle)}`,
        });
      } else {
        results.push({
          severity: "warn",
          message: `Workflow runs Waybar hidden-empty CSS is missing: ${displayPath(waybarStyle)}`,
          detail:
            "Update the Waybar style so the workflow icon hides when there are no recent runs needing attention",
        });
      }
    } catch {
      /* ignore */
    }
  } else {
    results.push({
      severity: "warn",
      message: `Waybar style file is missing: ${displayPath(waybarStyle)}`,
    });
  }

  // Waybar config — find host-specific or default
  const omarchyHost = process.env.OMARCHY_HOST ?? "";
  const waybarConfigDir = join(XDG_CONFIG_HOME, "waybar");
  const hostConfig = omarchyHost
    ? join(waybarConfigDir, `config.${omarchyHost}.jsonc`)
    : "";
  const waybarConfig =
    hostConfig && existsSync(hostConfig)
      ? hostConfig
      : join(waybarConfigDir, "config.jsonc");

  if (existsSync(waybarConfig)) {
    results.push({
      severity: "ok",
      message: `Workflow watch active Waybar config: ${displayPath(waybarConfig)}`,
    });

    // Walk config and includes to check for module, click actions, and ordering
    const configContains = (needle: string): boolean =>
      waybarConfigWalkContains(waybarConfig, needle);

    if (configContains('"custom/github-workflows"')) {
      results.push({
        severity: "ok",
        message: "Workflow runs Waybar module is present in the active config",
      });
    } else {
      results.push({
        severity: "warn",
        message: `Workflow runs Waybar module is missing from ${displayPath(waybarConfig)}`,
        detail:
          "Add custom/github-workflows before custom/dot-diff in the active Waybar config",
      });
    }

    if (
      configContains(
        '"on-click": "~/.config/waybar/scripts/github-workflows-waybar.sh open"',
      )
    ) {
      results.push({
        severity: "ok",
        message: "Workflow runs Waybar left click opens the filtered TUI",
      });
    } else {
      results.push({
        severity: "warn",
        message: `Workflow runs Waybar left-click action is missing in ${displayPath(waybarConfig)}`,
      });
    }

    if (
      configContains(
        '"on-click-right": "~/.config/waybar/scripts/github-workflows-waybar.sh refresh"',
      )
    ) {
      results.push({
        severity: "ok",
        message: "Workflow runs Waybar right click refreshes the cache",
      });
    } else {
      results.push({
        severity: "warn",
        message: `Workflow runs Waybar right-click refresh action is missing in ${displayPath(waybarConfig)}`,
      });
    }

    if (
      waybarConfigWalkOrdersBefore(
        waybarConfig,
        '"custom/github-workflows"',
        '"custom/dot-diff"',
      )
    ) {
      results.push({
        severity: "ok",
        message: "Workflow runs Waybar module is ordered before dot diff",
      });
    } else {
      results.push({
        severity: "warn",
        message: `Workflow runs Waybar module is not ordered before dot diff in ${displayPath(waybarConfig)}`,
      });
    }
  } else {
    results.push({
      severity: "warn",
      message: `Active Waybar config is missing: ${displayPath(waybarConfig)}`,
    });
  }

  // notify-send action support
  const hasNotifySend =
    (yield* executor.exitCode("which", ["notify-send"])) === 0;
  if (hasNotifySend) {
    const helpOutput = yield* executor
      .run("bash", ["-c", "notify-send --help 2>&1"])
      .pipe(Effect.catch(() => Effect.succeed("")));
    if (helpOutput.includes("--action")) {
      results.push({
        severity: "ok",
        message: "notify-send supports clickable notification actions",
      });
    } else {
      results.push({
        severity: "warn",
        message:
          "notify-send does not advertise action support; workflow notifications may not open runs on click",
      });
    }
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
