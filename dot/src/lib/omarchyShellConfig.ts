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
  purple: "#ac77e5",
  teal: "#2bb3b1",
  red: "#e06c75",
  amber: "#e5c07b",
  green: "#98c379",
  blue: "#61afef",
  grey: "#9b9b9b",
  rust: "#a55555",
  orange: "#e7ad63",
  tan: "#c6a47a",
  vocCritical: "#bf6a4e",
  co2Critical: "#d56f69",
  cream: "#fef6ea",
} as const;

const HA = "http://homeassistant.local:8123";

/** Launch a webapp and float only the window created by this shell click. */
function floatingWebapp(url: string): string {
  return `launch-floating-webapp '${url}'`;
}

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

/** Widget id of Omarchy's default tray bar entry (right-column anchor). */
const TRAY_ID = "omarchy.tray";

/** Widget id of Omarchy's default AI agents bar entry. */
const AGENTS_ID = "omarchy.agents";

/** Widget id immediately before network in Omarchy's default right column. */
const BLUETOOTH_ID = "omarchy.bluetooth";

/** Build a polling `timmo.command` bar entry. */
function command(settings: Omit<BarEntry, "id">): BarEntry {
  return { id: "timmo.command", revealOnHover: true, ...settings };
}

/** Build a streaming `timmo.stream-command` bar entry. */
function stream(settings: Omit<BarEntry, "id">): BarEntry {
  return { id: "timmo.stream-command", revealOnHover: true, ...settings };
}

/** Resolve the host-specific temperature module settings. */
function temperatureEntry(host: string): BarEntry {
  const desktop = host === "desktop";
  const entity = desktop
    ? "sensor.meter_d828_temperature"
    : "sensor.meter_plus_378b_temperature";
  const name = desktop ? "Meter D828 Temperature" : "Meter Plus Temperature";
  const page = desktop ? "office" : "living-room";
  return command({
    run: `ha-module-bar temperature --entity ${entity} --name '${name}' --icon 󰔏`,
    interval: 15000,
    onClick: floatingWebapp(
      `${HA}/lovelace/${page}?more-info-entity-id=${entity}`,
    ),
    classColors: { temperature: COLOR.cream },
    hideClasses: ["hidden"],
    hiddenText: "󰔏",
    revealColor: COLOR.cream,
  });
}

/**
 * Laptop-only dining-room temperature module. A second Home Assistant
 * temperature sensor shown alongside the main one, matching the living-room
 * temperature module (plain reading, no gating).
 */
function diningTemperatureEntry(): BarEntry {
  const entity = "sensor.meter_plus_433c_temperature";
  return command({
    run: `ha-module-bar temperature --entity ${entity} --name 'Dining Room Temperature' --icon 󰩰`,
    interval: 15000,
    onClick: floatingWebapp(
      `${HA}/lovelace/home?more-info-entity-id=${entity}`,
    ),
    classColors: { temperature: COLOR.cream },
    hideClasses: ["hidden"],
    hiddenText: "󰩰",
    revealColor: COLOR.cream,
  });
}

/** Outdoor weather-station temperature revealed while the bar is hovered. */
function outdoorTemperatureEntry(): BarEntry {
  const entity = "sensor.weather_station_outdoor_temperature";
  return command({
    run: `ha-module-bar temperature --entity ${entity} --name 'Weather Station Outdoor Temperature' --icon 󰖙`,
    interval: 15000,
    onClick: floatingWebapp(
      `${HA}/home?more-info-entity-id=weather.met_office&more-info-view=info#forecast=hourly`,
    ),
    classColors: { temperature: COLOR.orange },
    hideClasses: ["temperature", "hidden"],
    hiddenText: "󰖙",
    revealColor: COLOR.orange,
  });
}

/** Resolve the host-specific CO2 module settings. */
function co2Entry(host: string): BarEntry {
  const desktop = host === "desktop";
  const entity = desktop
    ? "sensor.meter_d828_carbon_dioxide"
    : "sensor.apollo_air_1_806d64_co2";
  const name = desktop ? "Meter D828 CO2" : "Apollo Air 1 CO2";
  return command({
    run: `ha-module-bar co2-alert --entity ${entity} --name '${name}' --icon 󰟤`,
    interval: 15000,
    onClick: floatingWebapp(
      `${HA}/lovelace/environment?more-info-entity-id=${entity}`,
    ),
    classColors: { warning: COLOR.orange, critical: COLOR.co2Critical },
    hideClasses: ["hidden"],
    hiddenText: "󰟤",
    revealColor: COLOR.orange,
  });
}

/** Build the doorbell module for the active workspace. */
function doorbellEntry(): BarEntry {
  const base =
    "doorbell-popup --open-only --camera-entity camera.front_door_snapshot";
  const triggerCommand = `${base} --no-auto-close`;
  return stream({
    // This stream exists only to launch the popup; it has no visual use and is
    // explicitly hidden in every state, including while the bar is hovered.
    run:
      "ha-module-bar doorbell --entity input_boolean.doorbell " +
      "--stream-key doorbell.input_boolean.doorbell --trigger-state on " +
      `--trigger-command '${triggerCommand}' --trigger-on transition ` +
      "--trigger-initial false --trigger-cooldown 2 " +
      "--trigger-key doorbell.popup.input_boolean.doorbell",
    hideClasses: ["active", "hidden"],
    revealOnHover: false,
  });
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

/** Personal calendar module appended to the default left column. */
function calendarEntry(): BarEntry {
  return command({
    run: "ha-module-bar current-next-event --entity input_text.current_next_event_in_an_hour --icon 󰃭",
    interval: 30000,
    onClick: floatingWebapp("https://calendar.google.com/calendar/u/0/r?pli=1"),
    hideClasses: ["hidden"],
    hiddenText: "󰃭",
  });
}

/** Personal status widgets inserted into the center column (host-independent). */
function customCenterEntries(): BarEntry[] {
  return [
    stream({
      run: "ha-watch-singleton --module time-check --entity input_boolean.time_check --icon 󱑎 --text-on 'Check the time' --tooltip-on 'Time Check (input_boolean.time_check): On' --tooltip-off 'Time Check (input_boolean.time_check): Off' --class-on active --class-off inactive --hide-off",
      onClick: "timmo-run-command go-automate ha ib t time_check",
      onClickRight: "timmo-run-command go-automate ha ib t time_check",
      classColors: { active: COLOR.purple },
      hideClasses: ["hidden"],
      hiddenText: "󱑎",
      revealColor: COLOR.purple,
    }),
    stream({
      run: "ha-watch-singleton --module in-a-call --entity input_boolean.in_a_call --icon  --tooltip-on 'In a Call (input_boolean.in_a_call): On' --tooltip-off 'In a Call (input_boolean.in_a_call): Off' --class-on active --class-off inactive --hide-off",
      onClick: "timmo-run-command go-automate ha ib t in_a_call",
      onClickRight: "timmo-run-command go-automate ha ib t in_a_call",
      classColors: { active: COLOR.teal },
      hideClasses: ["hidden"],
      hiddenText: "󰍸",
      revealColor: COLOR.teal,
    }),
    command({
      run: "ha-module-bar nas-activity --icon 󰒋",
      interval: 5000,
      onClick: floatingWebapp(
        `${HA}/lovelace/network?more-info-entity-id=sensor.nas_activity`,
      ),
      classColors: { active: COLOR.teal },
      hideClasses: ["hidden"],
      hiddenText: "󰒋 0",
      revealColor: COLOR.teal,
    }),
    command({
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
    command({
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
    command({
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
    { id: "timmo.twitch", revealOnHover: true },
  ];
}

/** Home Assistant sensors inserted before the default right-column cluster. */
function customRightEntries(host: string): BarEntry[] {
  return [
    stream({
      run: "ha-watch-singleton --module heating --entity sensor.thermostat_status --icon 󰈸 --tooltip-on 'Thermostat Status (sensor.thermostat_status)' --class-on heating --class-off hidden --hide-off",
      onClick: floatingWebapp(
        `${HA}/lovelace/home?more-info-entity-id=sensor.thermostat_status`,
      ),
      classColors: { heating: COLOR.orange },
      hideClasses: ["hidden"],
      hiddenText: "󰈸",
      revealColor: COLOR.orange,
    }),
    // voc-alert is permanently hidden on desktop, so it is omitted there.
    ...(host === "desktop"
      ? []
      : [
          command({
            run: "ha-module-bar voc-alert --quality-entity sensor.apollo_air_1_806d64_voc_quality --value-entity sensor.apollo_air_1_806d64_sen55_voc --name 'Apollo Air 1 VOC' --icon 󰵃",
            interval: 15000,
            onClick: floatingWebapp(
              `${HA}/lovelace/environment?more-info-entity-id=sensor.apollo_air_1_806d64_sen55_voc`,
            ),
            classColors: { warning: COLOR.tan, critical: COLOR.vocCritical },
            hideClasses: ["hidden"],
            hiddenText: "󰵃",
            revealColor: COLOR.tan,
          }),
        ]),
    co2Entry(host),
    stream({
      run: "ha-watch-singleton --module rain --entity binary_sensor.weather_station_rain_state_piezo --icon 󰖖 --tooltip-on 'Weather Station Rain State Piezo (binary_sensor.weather_station_rain_state_piezo): Raining' --tooltip-off 'Weather Station Rain State Piezo (binary_sensor.weather_station_rain_state_piezo): Not raining' --class-on raining --class-off hidden --hide-off",
      onClick: floatingWebapp(
        `${HA}/home/areas-048a0fd33b134e3689eda6212a41b99d?more-info-entity-id=binary_sensor.weather_station_rain_state_piezo`,
      ),
      classColors: { raining: COLOR.blue },
      hideClasses: ["hidden"],
      hiddenText: "󰖖",
      revealColor: COLOR.blue,
    }),
    temperatureEntry(host),
    // Laptop shows a second (dining room) temperature alongside the main one.
    ...(host === "laptop" ? [diningTemperatureEntry()] : []),
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
 * are inserted around them ("add, not remove"). The clock stays as the centre
 * anchor on desktop but moves to the end of the right section on laptop; the
 * stock weather widget is replaced by the outdoor temperature immediately
 * after the tray expansion.
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
  // opacity), then append the personal calendar module.
  const workspacesIndex = left.findIndex((entry) => entry.id === WORKSPACES_ID);
  if (workspacesIndex !== -1) left[workspacesIndex] = workspacesEntry();
  left.push(calendarEntry());

  // Center: keep the clock as the desktop anchor, but move it to the far right
  // on laptop. Remove weather (replaced in the right column below), insert
  // personal status widgets before the default system-update group, and put
  // the doorbell trigger at the very end. All custom widgets fade in dimmed
  // when class-hidden and the bar is hovered. They share a standard 8px margin
  // (the widget default), so no per-instance margin is needed here.
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
  if (host === "laptop") {
    if (clockIndex !== -1) right.push(...center.splice(clockIndex, 1));
  }
  const weatherIndex = center.findIndex((entry) => entry.id === WEATHER_ID);
  if (weatherIndex !== -1) center.splice(weatherIndex, 1);
  insertBefore(center, SYSTEM_UPDATE_ID, customCenterEntries());
  center.push(doorbellEntry());

  // Right: Omarchy pins the tray to the section's inner edge at runtime, so
  // weather must be the first non-tray entry to render immediately after it.
  // The remaining Home Assistant sensors follow weather and precede the stock
  // system widgets.
  const agentsIndex = right.findIndex((entry) => entry.id === AGENTS_ID);
  const agentsEntry =
    agentsIndex === -1 ? undefined : right.splice(agentsIndex, 1)[0];
  insertBefore(right, TRAY_ID, customRightEntries(host));
  right.unshift(outdoorTemperatureEntry());
  if (agentsEntry) {
    insertBefore(right, BLUETOOTH_ID, [agentsEntry]);
  }

  // The stock config gear renders next to the centred clock on desktop.
  base.bar.centerAnchor = host === "laptop" ? "" : CLOCK_ID;

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
