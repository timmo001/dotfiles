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
  /** Persistent bar placement. */
  readonly placement: ManagedPluginPlacement;
  /** Settings applied to every host. */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** Settings applied only to a named host. */
  readonly hosts?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** Declarative customisation applied to Omarchy's stock shell layout. */
export interface ManagedPluginConfig {
  /** Stock widgets removed from the generated layout. */
  readonly remove: readonly string[];
  /** Custom widgets placed into the generated layout. */
  readonly plugins: readonly ManagedPlugin[];
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

/** Place a managed widget after removing any previous instance. */
function placeManagedPlugin(
  layout: ShellLayout,
  plugin: ManagedPlugin,
  host: string,
): void {
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

  const entries = layout[plugin.placement.section];
  const beforeIndex = plugin.placement.before
    ? entries.findIndex((entry) => entry.id === plugin.placement.before)
    : -1;
  const afterIndex = plugin.placement.after
    ? entries.findIndex((entry) => entry.id === plugin.placement.after)
    : -1;
  const index =
    beforeIndex !== -1
      ? beforeIndex
      : afterIndex !== -1
        ? afterIndex + 1
        : plugin.placement.index === undefined
          ? entries.length
          : Math.min(plugin.placement.index, entries.length);
  entries.splice(index, 0, {
    ...(plugin.inheritSettings === false ? {} : existing),
    id: plugin.id,
    ...plugin.settings,
    ...plugin.hosts?.[host],
  });
}

/** Parse the managed-plugin registry consumed by the shell generator. */
export function parseManagedPlugins(
  value: unknown,
): ManagedPluginConfig | null {
  if (typeof value !== "object" || value === null) return null;
  const { remove, plugins } = value as {
    remove?: unknown;
    plugins?: unknown;
  };
  if (
    !Array.isArray(remove) ||
    !remove.every((id) => typeof id === "string" && isPluginId(id))
  )
    return null;
  if (!Array.isArray(plugins)) return null;

  const parsed: ManagedPlugin[] = [];
  const ids = new Set<string>();
  for (const plugin of plugins) {
    if (typeof plugin !== "object" || plugin === null) return null;
    const {
      id,
      managed,
      replace,
      inheritSettings,
      placement,
      settings,
      hosts,
    } = plugin as {
      id?: unknown;
      managed?: unknown;
      replace?: unknown;
      inheritSettings?: unknown;
      placement?: unknown;
      settings?: unknown;
      hosts?: unknown;
    };
    if (typeof id !== "string" || !isPluginId(id) || ids.has(id)) return null;
    ids.add(id);
    if (managed !== undefined && typeof managed !== "boolean") return null;
    if (replace !== undefined && !isPluginId(replace)) return null;
    if (inheritSettings !== undefined && typeof inheritSettings !== "boolean")
      return null;
    if (settings !== undefined && !isSettings(settings)) return null;
    if (
      hosts !== undefined &&
      (typeof hosts !== "object" ||
        hosts === null ||
        Array.isArray(hosts) ||
        !Object.values(hosts).every(isSettings))
    )
      return null;
    if (typeof placement !== "object" || placement === null) return null;
    const { section, before, after, index } = placement as {
      section?: unknown;
      before?: unknown;
      after?: unknown;
      index?: unknown;
    };
    if (section !== "left" && section !== "center" && section !== "right")
      return null;
    if (before !== undefined && typeof before !== "string") return null;
    if (after !== undefined && typeof after !== "string") return null;
    if (before !== undefined && after !== undefined) return null;
    if (
      index !== undefined &&
      (!Number.isInteger(index) || (index as number) < 0)
    )
      return null;
    if (index !== undefined && (before !== undefined || after !== undefined))
      return null;
    parsed.push({
      id,
      ...(managed === undefined ? {} : { managed }),
      ...(replace === undefined ? {} : { replace }),
      ...(inheritSettings === undefined ? {} : { inheritSettings }),
      placement: {
        section,
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
        ...(index === undefined ? {} : { index: index as number }),
      },
      ...(settings === undefined ? {} : { settings }),
      ...(hosts === undefined
        ? {}
        : {
            hosts: hosts as Record<string, Readonly<Record<string, unknown>>>,
          }),
    });
  }
  return { remove, plugins: parsed };
}

function isPluginId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) &&
    !value.includes("..")
  );
}

function isSettings(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    placeManagedPlugin(base.bar.layout, plugin, host);
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

  const managedPluginsPath = join(
    config.publicDotfiles,
    "omarchy-plugins.json",
  );
  const managedPlugins = yield* Effect.sync((): ManagedPluginConfig | null => {
    try {
      return parseManagedPlugins(
        JSON.parse(readFileSync(managedPluginsPath, "utf-8")),
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

  const target = join(omarchyDir, "shell.json");
  const merged = mergeOmarchyShellConfig(parsed, host, managedPlugins);
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
