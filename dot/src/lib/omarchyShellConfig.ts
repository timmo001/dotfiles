import { Effect } from "effect";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { CONFIG_DIR, HOME_DIR, displayPath } from "./paths.js";
import { ENV, envString } from "./env.js";
import { resolvedOmarchyHost } from "./omarchyHost.js";

/** A single bar layout entry: a plugin id plus inline per-instance settings. */
interface BarEntry {
  readonly id: string;
  readonly [key: string]: unknown;
}

/** The bar layout columns of an Omarchy `shell.json`. */
interface ShellLayout {
  left: BarEntry[];
  center: BarEntry[];
  right: BarEntry[];
}

/** The `bar` block of an Omarchy `shell.json` (unknown fields preserved). */
interface ShellBar {
  position?: string;
  layout: ShellLayout;
  [key: string]: unknown;
}

/**
 * The parts of Omarchy's `shell.json` this generator reads and mutates. All
 * other fields (`version`, `centerAnchor`, clock formats, weather, future
 * additions) are preserved verbatim via the index signatures.
 */
interface ShellConfig {
  idle?: { screensaver: number; lock: number };
  bar: ShellBar;
  [key: string]: unknown;
}

/**
 * Class-name to colour map ported from the legacy Waybar `style.css`. Used by
 * the `timmo.command` / `timmo.stream-command` widgets to colour their output.
 */
const COLOR = {
  red: "#e06c75",
  amber: "#e5c07b",
  green: "#98c379",
  blue: "#61afef",
  grey: "#9b9b9b",
} as const;

/** Widget id of Omarchy's default workspaces bar entry (left column). */
const WORKSPACES_ID = "omarchy.workspaces";

/** Widget id of Omarchy's default clock bar entry. */
const DEFAULT_CLOCK_ID = "omarchy.clock";

/** Personal clone of Omarchy's clock with compact padding. */
const CLOCK_ID = "timmo.clock";

/** Compact clock format matching the final pre-Quattro Waybar layout. */
const CLOCK_FORMAT = "HH:mm d MMM";

/** Widget id of Omarchy's default weather bar entry (center column). */
const WEATHER_ID = "omarchy.weather";

/** Widget id of Omarchy's default system-update bar entry (center anchor). */
const SYSTEM_UPDATE_ID = "omarchy.system-update";

/** Resolve the host's preferred output for personal status widgets. */
function primaryOutput(host: string): string {
  if (host === "desktop") return "HDMI-A-2";
  if (host === "laptop") return "eDP-1";
  return "";
}

/** Build a polling `timmo.command` bar entry. */
function command(host: string, settings: Omit<BarEntry, "id">): BarEntry {
  return {
    id: "timmo.command",
    revealOnHover: true,
    primaryOnly: true,
    primaryOutput: primaryOutput(host),
    ...settings,
  };
}

/**
 * Personal workspaces module that replaces Omarchy's default `omarchy.workspaces`
 * widget. The `timmo.workspaces` plugin drops persistent workspaces (only the
 * workspaces that currently exist are shown) and renders the focused workspace
 * as its number at full opacity, with the rest dimmed — the old Waybar
 * behaviour. Opacity is set explicitly here so it is tunable in one place.
 */
function workspacesEntry(): BarEntry {
  return { id: "timmo.workspaces", activeOpacity: 1, inactiveOpacity: 0.5 };
}

/** Unified Home Assistant status widget placed beside the tray. */
function homeAssistantEntry(host: string): BarEntry {
  return {
    id: "timmo.home-assistant",
    host,
    primaryOnly: true,
    primaryOutput: primaryOutput(host),
  };
}

/** Personal status widgets inserted into the center column. */
function customCenterEntries(host: string): BarEntry[] {
  return [
    {
      id: "timmo.twitch",
      revealOnHover: true,
      primaryOnly: true,
      primaryOutput: primaryOutput(host),
    },
    command(host, {
      run: "dot git-diff --bar-json",
      interval: 60000,
      refreshTarget: "timmo.git-diff",
      loadingText: "\uf418 ..",
      loadingClass: "dots-unknown",
      onClick:
        "uwsm app -- xdg-terminal-exec --app-id=TUI.float -e dot tui git-diff",
      onClickRight:
        "uwsm app -- xdg-terminal-exec --app-id=TUI.float -e dot tui git-diff --tab other",
      classColors: {
        "dots-ok": COLOR.grey,
        "dots-unknown": COLOR.grey,
        "dots-attention": COLOR.amber,
        "dots-pull-only": COLOR.green,
        "dots-extra-only": COLOR.blue,
      },
      // The "0" (all repos clean) state hides like the other status widgets
      // and is revealed dimmed on bar hover; non-zero counts always
      // show. The bar-json still emits " 0" so there is an icon to reveal.
      hideClasses: ["dots-ok"],
      revealColor: COLOR.amber,
    }),
    command(host, {
      run: "dot git-notifications --bar-json",
      interval: 60000,
      refreshTarget: "timmo.git-notifications",
      loadingText: "\uf0f3 ..",
      loadingClass: "notifications-unknown",
      onClick:
        "uwsm app -- xdg-terminal-exec --app-id=TUI.float -e dot git-notifications --bar-filter",
      onClickRight: "omarchy-shell -q timmo.git-notifications refresh",
      classColors: {
        "notifications-unknown": COLOR.grey,
        "notifications-attention": COLOR.red,
        "notifications-unread": COLOR.amber,
      },
      hideClasses: ["hidden"],
      revealColor: COLOR.amber,
    }),
    command(host, {
      run: "package-updates-bar status",
      interval: 60000,
      refreshTarget: "timmo.package-updates",
      loadingText: "󰏗 ..",
      loadingClass: "package-updates-unknown",
      onClickRight: "package-updates-bar refresh",
      classColors: {
        "package-updates-unknown": COLOR.grey,
        "package-updates": COLOR.amber,
      },
      hideClasses: ["hidden"],
      hiddenText: "󰏗 0",
      revealColor: COLOR.amber,
    }),
  ];
}

/** Path to Omarchy's shipped default `shell.json` under `$OMARCHY_PATH`. */
function omarchyDefaultShellConfigPath(): string {
  const base =
    envString(ENV.OMARCHY_PATH) ?? join(HOME_DIR, ".local", "share", "omarchy");
  return join(base, "config", "omarchy", "shell.json");
}

/** Narrow an unknown value to a `BarEntry[]` (array of `{ id: string, ... }`). */
function isBarEntryArray(value: unknown): value is BarEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { id?: unknown }).id === "string",
    )
  );
}

/** Narrow parsed JSON to the {@link ShellConfig} shape this generator mutates. */
function isShellConfig(value: unknown): value is ShellConfig {
  if (typeof value !== "object" || value === null) return false;
  const bar = (value as { bar?: unknown }).bar;
  if (typeof bar !== "object" || bar === null) return false;
  const layout = (bar as { layout?: unknown }).layout;
  if (typeof layout !== "object" || layout === null) return false;
  const { left, center, right } = layout as {
    left?: unknown;
    center?: unknown;
    right?: unknown;
  };
  return (
    isBarEntryArray(left) && isBarEntryArray(center) && isBarEntryArray(right)
  );
}

/** Insert `additions` before the first entry matching `anchorId`, else append. */
function insertBefore(
  entries: BarEntry[],
  anchorId: string,
  additions: readonly BarEntry[],
): void {
  const index = entries.findIndex((entry) => entry.id === anchorId);
  if (index === -1) entries.push(...additions);
  else entries.splice(index, 0, ...additions);
}

/**
 * Merge personal widgets and host overrides into Omarchy's default shell
 * config, mutating `base` in place. Default widgets are kept; personal modules
 * are inserted around them ("add, not remove"). The clock moves to the end of
 * the right section; the stock weather widget is replaced by the unified Home
 * Assistant dashboard immediately after the tray expansion.
 *
 * @param base - Parsed Omarchy default `shell.json`.
 * @param host - The `OMARCHY_HOST` value (e.g. `desktop`, `laptop`).
 */
export function mergeOmarchyShellConfig(
  base: ShellConfig,
  host: string,
): ShellConfig {
  base.idle =
    host === "laptop"
      ? { screensaver: 150, lock: 300 }
      : { screensaver: 1800, lock: 3600 };
  base.bar.position = host === "laptop" ? "bottom" : "top";

  const { left, center, right } = base.bar.layout;

  // Left: swap Omarchy's persistent workspaces widget for the personal
  // timmo.workspaces widget (no persistent workspaces, focused at full
  // opacity).
  const workspacesIndex = left.findIndex((entry) => entry.id === WORKSPACES_ID);
  if (workspacesIndex !== -1) left[workspacesIndex] = workspacesEntry();

  // Center: move the clock to the far right. Remove weather (replaced by the
  // Home Assistant dashboard below), then insert personal status widgets
  // before the default system-update group.
  const clockIndex = center.findIndex(
    (entry) => entry.id === DEFAULT_CLOCK_ID || entry.id === CLOCK_ID,
  );
  if (clockIndex !== -1) {
    center[clockIndex] = {
      ...center[clockIndex],
      id: CLOCK_ID,
      format: CLOCK_FORMAT,
    };
  }
  if (clockIndex !== -1) right.push(...center.splice(clockIndex, 1));
  const weatherIndex = center.findIndex((entry) => entry.id === WEATHER_ID);
  if (weatherIndex !== -1) center.splice(weatherIndex, 1);
  insertBefore(center, SYSTEM_UPDATE_ID, customCenterEntries(host));

  // Right: Omarchy pins the tray to the section's inner edge at runtime, so
  // the unified Home Assistant widget is first in the array to render
  // immediately after it. The service owns all sensor and doorbell processes.
  const agentsIndex = right.findIndex((entry) => entry.id === "omarchy.agents");
  if (agentsIndex !== -1) right.splice(agentsIndex, 1);
  right.unshift(homeAssistantEntry(host));

  base.bar.centerAnchor = "";

  return base;
}

/**
 * Generate and apply the per-host Quickshell `shell.json` by extending
 * Omarchy's shipped default with the personal modules. Reads the default from
 * `$OMARCHY_PATH/config/omarchy/shell.json`, inserts the custom widgets, and
 * writes the result. Idempotent: only writes when the rendered content
 * differs. Skips silently when Omarchy is disabled, the host is unknown,
 * Omarchy is not installed, or no default shell config exists (pre-Omarchy 4).
 *
 * @returns `true` when `shell.json` was rewritten (content changed), `false`
 *   when it was already up to date or the step was skipped. Callers use this to
 *   decide whether the running shell needs reloading.
 */
export const applyOmarchyShellConfig: Effect.Effect<
  boolean,
  never,
  Config | OutputLog
> = Effect.gen(function* () {
  const config = yield* Config;
  const log = yield* OutputLog;

  if (!config.omarchy.enabled) return false;

  const host = resolvedOmarchyHost(config);
  if (!host) {
    yield* log.info(
      "Skipping Omarchy shell config (OMARCHY_HOST and Hypr host link are unset)",
    );
    return false;
  }

  const omarchyDir = join(CONFIG_DIR, "omarchy");
  if (!existsSync(omarchyDir)) {
    yield* log.info(
      `Skipping Omarchy shell config (${displayPath(omarchyDir)} not found)`,
    );
    return false;
  }

  const defaultPath = omarchyDefaultShellConfigPath();
  if (!existsSync(defaultPath)) {
    yield* log.info(
      `Skipping Omarchy shell config (no default at ${displayPath(defaultPath)}; pre-Omarchy 4?)`,
    );
    return false;
  }

  const parsed = yield* Effect.sync((): unknown => {
    try {
      return JSON.parse(readFileSync(defaultPath, "utf-8"));
    } catch {
      return undefined;
    }
  });
  if (parsed === undefined) {
    yield* log.warn(
      `Skipping Omarchy shell config (could not read ${displayPath(defaultPath)})`,
    );
    return false;
  }

  if (!isShellConfig(parsed)) {
    yield* log.warn(
      `Skipping Omarchy shell config (unexpected default shape in ${displayPath(defaultPath)})`,
    );
    return false;
  }

  const target = join(omarchyDir, "shell.json");
  const merged = mergeOmarchyShellConfig(parsed, host);
  const rendered = `${JSON.stringify(merged, null, 2)}\n`;

  const existing = existsSync(target)
    ? yield* Effect.sync(() => readFileSync(target, "utf-8"))
    : null;
  if (existing === rendered) {
    yield* log.info(
      `Omarchy shell config up to date: ${displayPath(target)} (host: ${host})`,
    );
    return false;
  }

  yield* Effect.sync(() => {
    const temporary = `${target}.dot-${process.pid}`;
    try {
      writeFileSync(temporary, rendered, { mode: 0o600 });
      chmodSync(temporary, 0o600);
      renameSync(temporary, target);
    } finally {
      rmSync(temporary, { force: true });
    }
  });
  yield* log.info(
    `Wrote Omarchy shell config: ${displayPath(target)} (host: ${host})`,
  );
  return true;
});
