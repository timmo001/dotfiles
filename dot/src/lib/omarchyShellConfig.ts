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
import {
  decodeJson,
  isBoolean,
  isJsonObject,
  isNumber,
  isString,
  type JsonObject,
  type JsonValue,
} from "./schema.js";

/** A single bar layout entry: a plugin id plus inline per-instance settings. */
interface BarEntry {
  id: string;
  readonly format?: string;
  readonly run?: string;
  readonly revealOnHover?: boolean;
  readonly primaryOnly?: boolean;
  readonly primaryOutput?: string;
  readonly persistent?: boolean;
  readonly customAgentField?: string;
  readonly [key: string]: string | number | boolean | undefined;
}

/** The bar layout columns of an Omarchy `shell.json`. */
interface ShellLayout {
  left: BarEntry[];
  center: BarEntry[];
  right: BarEntry[];
  [key: string]: BarEntry[];
}

/** A bar section accepted by Omarchy's placement commands. */
type BarSection = keyof ShellLayout;

/** Persisted placement for a managed third-party bar widget. */
export interface ManagedPluginPlacement {
  /** Target bar section. */
  readonly section: BarSection;
  /** Insert before this widget when present. */
  readonly before?: string;
  /** Insert after this widget when present. */
  readonly after?: string;
  /** Insert at this zero-based index when supplied. */
  readonly index?: number;
}

interface PluginSettings {
  readonly [key: string]: JsonValue | undefined;
}

/** A third-party plugin whose source and layout are managed by dotfiles. */
export interface ManagedPlugin {
  /** Plugin manifest id. */
  readonly id: string;
  /** Whether source lifecycle is managed as a Git submodule. */
  readonly managed?: boolean;
  /** Stock widget id replaced by this plugin. */
  readonly replace?: string;
  /** Whether settings from a replaced stock entry are preserved. */
  readonly inheritSettings?: boolean;
  /** Persistent bar placement. Omit for a non-widget shell plugin. */
  readonly placement?: ManagedPluginPlacement;
  /** Settings applied to every host. */
  readonly settings?: PluginSettings;
  /** Settings applied only to a named host. */
  readonly hosts?: ManagedPluginHosts;
}

interface ManagedPluginHosts {
  readonly [host: string]: PluginSettings;
}

/** Declarative customisation applied to Omarchy's stock shell layout. */
export interface ManagedPluginConfig {
  /** Stock widgets removed from the generated layout. */
  readonly remove: readonly string[];
  /** Custom widgets placed into the generated layout. */
  readonly plugins: readonly ManagedPlugin[];
}

/** Merge an optional private plugin registry over the public registry. */
export function mergeManagedPluginConfigs(
  publicConfig: ManagedPluginConfig,
  privateConfig: ManagedPluginConfig,
): ManagedPluginConfig {
  const privateIds = new Set(privateConfig.plugins.map(({ id }) => id));
  return {
    remove: [...new Set([...publicConfig.remove, ...privateConfig.remove])],
    plugins: [
      ...publicConfig.plugins.filter(({ id }) => !privateIds.has(id)),
      ...privateConfig.plugins,
    ],
  };
}

/** The `bar` block of an Omarchy `shell.json` (unknown fields preserved). */
interface ShellBar {
  position?: string;
  centerAnchor?: string;
  layout: ShellLayout;
  [key: string]: JsonValue | ShellLayout | undefined;
}

/**
 * The parts of Omarchy's `shell.json` this generator reads and mutates. All
 * other fields (`version`, `centerAnchor`, clock formats, weather, future
 * additions) are preserved verbatim via the index signatures.
 */
interface ShellConfig {
  idle?: { screensaver: number; lock: number };
  bar: ShellBar;
  plugins?: BarEntry[];
  [key: string]:
    | JsonValue
    | ShellBar
    | BarEntry[]
    | { screensaver: number; lock: number }
    | undefined;
}

interface MutablePluginPlacement {
  section: BarSection;
  before?: string;
  after?: string;
  index?: number;
}

interface MutableManagedPlugin {
  id: string;
  managed?: boolean;
  replace?: string;
  inheritSettings?: boolean;
  placement?: ManagedPluginPlacement;
  settings?: PluginSettings;
  hosts?: ManagedPluginHosts;
}

/** Path to Omarchy's shipped default `shell.json` under `$OMARCHY_PATH`. */
function omarchyDefaultShellConfigPath(): string {
  const base =
    envString(ENV.OMARCHY_PATH) ?? join(HOME_DIR, ".local", "share", "omarchy");
  return join(base, "config", "omarchy", "shell.json");
}

/** Narrow an unknown value to a `BarEntry[]` (array of `{ id: string, ... }`). */
function isBarEntryArray(value: JsonValue): boolean {
  return (
    Array.isArray(value) &&
    value.every((entry) => isJsonObject(entry) && isString(entry.id))
  );
}

/** Narrow parsed JSON to the {@link ShellConfig} shape this generator mutates. */
function isShellConfig(value: JsonValue): value is JsonObject {
  if (!isJsonObject(value)) return false;
  const bar = value.bar;
  if (bar === undefined || !isJsonObject(bar)) return false;
  const layout = bar.layout;
  if (layout === undefined || !isJsonObject(layout)) return false;
  const { left, center, right } = layout;
  return (
    isBarEntryArray(left) && isBarEntryArray(center) && isBarEntryArray(right)
  );
}

/** Place a managed widget after removing any previous instance. */
function placeManagedPlugin(
  layout: ShellLayout,
  plugin: ManagedPlugin,
  host: string,
): void {
  const placement = plugin.placement;
  if (!placement) return;
  let existing: BarEntry | undefined;
  for (const entries of [layout.left, layout.center, layout.right]) {
    let index = entries.findIndex(
      (entry) => entry.id === plugin.id || entry.id === plugin.replace,
    );
    while (index !== -1) {
      existing ??= entries[index];
      entries.splice(index, 1);
      index = entries.findIndex(
        (entry) => entry.id === plugin.id || entry.id === plugin.replace,
      );
    }
  }

  const entries = layout[placement.section];
  const beforeIndex = placement.before
    ? entries.findIndex((entry) => entry.id === placement.before)
    : -1;
  const afterIndex = placement.after
    ? entries.findIndex((entry) => entry.id === placement.after)
    : -1;
  const index =
    beforeIndex !== -1
      ? beforeIndex
      : afterIndex !== -1
        ? afterIndex + 1
        : placement.index === undefined
          ? entries.length
          : Math.min(placement.index, entries.length);
  const entry: BarEntry = { id: plugin.id };
  if (plugin.inheritSettings !== false && existing)
    Object.assign(entry, existing);
  entry.id = plugin.id;
  if (plugin.settings) Object.assign(entry, plugin.settings);
  if (plugin.hosts?.[host]) Object.assign(entry, plugin.hosts[host]);
  entries.splice(index, 0, entry);
}

/** Parse the managed-plugin registry consumed by the shell generator. */
export function parseManagedPlugins(
  value: JsonValue,
): ManagedPluginConfig | null {
  if (!isJsonObject(value)) return null;
  const { remove, plugins } = value;
  if (
    !Array.isArray(remove) ||
    !remove.every((id) => isString(id) && isPluginId(id))
  )
    return null;
  if (!Array.isArray(plugins)) return null;

  const parsed: ManagedPlugin[] = [];
  const ids = new Set<string>();
  for (const plugin of plugins) {
    if (!isJsonObject(plugin)) return null;
    const {
      id,
      managed,
      replace,
      inheritSettings,
      placement,
      settings,
      hosts,
    } = plugin;
    if (!isString(id) || !isPluginId(id) || ids.has(id)) return null;
    ids.add(id);
    if (managed !== undefined && !isBoolean(managed)) return null;
    if (replace !== undefined && !isPluginId(replace)) return null;
    if (inheritSettings !== undefined && !isBoolean(inheritSettings))
      return null;
    if (settings !== undefined && !isSettings(settings)) return null;
    if (
      hosts !== undefined &&
      (!isJsonObject(hosts) || !Object.values(hosts).every(isSettings))
    )
      return null;
    const parsedPlugin: MutableManagedPlugin = { id };
    if (placement !== undefined) {
      if (!isJsonObject(placement)) return null;
      const { section, before, after, index } = placement;
      if (section !== "left" && section !== "center" && section !== "right")
        return null;
      if (before !== undefined && !isString(before)) return null;
      if (after !== undefined && !isString(after)) return null;
      if (before !== undefined && after !== undefined) return null;
      if (
        index !== undefined &&
        (!isNumber(index) || !Number.isInteger(index) || index < 0)
      )
        return null;
      if (index !== undefined && (before !== undefined || after !== undefined))
        return null;
      const parsedPlacement: MutablePluginPlacement = { section };
      if (before !== undefined) parsedPlacement.before = before;
      if (after !== undefined) parsedPlacement.after = after;
      if (index !== undefined && isNumber(index)) parsedPlacement.index = index;
      parsedPlugin.placement = parsedPlacement;
    } else if (replace !== undefined || inheritSettings !== undefined) {
      return null;
    }
    if (managed !== undefined && isBoolean(managed))
      parsedPlugin.managed = managed;
    if (replace !== undefined && isString(replace))
      parsedPlugin.replace = replace;
    if (inheritSettings !== undefined && isBoolean(inheritSettings))
      parsedPlugin.inheritSettings = inheritSettings;
    if (settings !== undefined && isSettings(settings))
      parsedPlugin.settings = settings;
    if (hosts !== undefined && isJsonObject(hosts)) {
      parsedPlugin.hosts = Object.fromEntries(
        Object.entries(hosts).filter((entry): entry is [string, JsonObject] =>
          isSettings(entry[1]),
        ),
      );
    }
    parsed.push(parsedPlugin);
  }
  return { remove, plugins: parsed };
}

function isPluginId(value: JsonValue): value is string {
  return (
    isString(value) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) &&
    !value.includes("..")
  );
}

function isSettings(value: JsonValue): value is JsonObject {
  return isJsonObject(value);
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
  managedPlugins: ManagedPluginConfig = { remove: [], plugins: [] },
): ShellConfig {
  base.idle =
    host === "laptop"
      ? { screensaver: 150, lock: 300 }
      : { screensaver: 1800, lock: 3600 };
  base.bar.position = host === "laptop" ? "bottom" : "top";

  for (const entries of [
    base.bar.layout.left,
    base.bar.layout.center,
    base.bar.layout.right,
  ]) {
    for (const id of managedPlugins.remove) {
      let index = entries.findIndex((entry) => entry.id === id);
      while (index !== -1) {
        entries.splice(index, 1);
        index = entries.findIndex((entry) => entry.id === id);
      }
    }
  }

  for (const plugin of managedPlugins.plugins) {
    if (plugin.placement) {
      placeManagedPlugin(base.bar.layout, plugin, host);
    } else {
      base.plugins ??= [];
      let entry = base.plugins.find(({ id }) => id === plugin.id);
      if (!entry) {
        entry = { id: plugin.id };
        base.plugins.push(entry);
      }
      if (plugin.settings) Object.assign(entry, plugin.settings);
      if (plugin.hosts?.[host]) Object.assign(entry, plugin.hosts[host]);
      entry.id = plugin.id;
    }
  }

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

  const parsed = yield* Effect.sync((): JsonValue | undefined => {
    try {
      return decodeJson(JSON.parse(readFileSync(defaultPath, "utf-8")));
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

  const managedPluginsPath = join(
    config.publicDotfiles,
    "omarchy-plugins.json",
  );
  let managedPlugins = yield* Effect.sync((): ManagedPluginConfig | null => {
    try {
      return parseManagedPlugins(
        decodeJson(JSON.parse(readFileSync(managedPluginsPath, "utf-8"))),
      );
    } catch {
      return null;
    }
  });
  if (managedPlugins === null) {
    yield* log.warn(
      `Skipping Omarchy shell config (invalid managed plugin registry at ${displayPath(managedPluginsPath)})`,
    );
    return false;
  }

  if (config.privateDotfiles) {
    const privateManagedPluginsPath = join(
      config.privateDotfiles,
      "omarchy-plugins.json",
    );
    if (existsSync(privateManagedPluginsPath)) {
      const privateManagedPlugins = yield* Effect.sync(
        (): ManagedPluginConfig | null => {
          try {
            return parseManagedPlugins(
              decodeJson(
                JSON.parse(readFileSync(privateManagedPluginsPath, "utf-8")),
              ),
            );
          } catch {
            return null;
          }
        },
      );
      if (privateManagedPlugins === null) {
        yield* log.warn(
          `Skipping Omarchy shell config (invalid private managed plugin registry at ${displayPath(privateManagedPluginsPath)})`,
        );
        return false;
      }
      managedPlugins = mergeManagedPluginConfigs(
        managedPlugins,
        privateManagedPlugins,
      );
    }
  }

  const target = join(omarchyDir, "shell.json");
  // SAFETY: isShellConfig validates the ShellConfig fields consumed here.
  const merged = mergeOmarchyShellConfig(
    parsed as ShellConfig,
    host,
    managedPlugins,
  );
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
