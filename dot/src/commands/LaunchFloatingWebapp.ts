import { Cause, Effect, Schema } from "effect";
import { decodeJson, type JsonValue } from "../lib/schema.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

const DETECT_ATTEMPTS = 80;
const DETECT_INTERVAL = "100 millis";

/** Options accepted by the floating webapp command. */
export interface FloatingWebappOptions {
  /** Target monitor, or the focused monitor when omitted. */
  readonly monitor?: string;
  /** Workspace to move the window to and use for monitor selection. */
  readonly workspace?: string;
  /** Floating window width. */
  readonly width: number;
  /** Floating window height. */
  readonly height: number;
  /** Gap from the monitor's usable right edge. */
  readonly rightMargin: number;
  /** Gap from the monitor's usable bottom edge. */
  readonly bottomMargin: number;
  /** Existing window address to reposition instead of launching. */
  readonly address?: string;
  /** Webapp URL to launch. */
  readonly url?: string;
}

/** Logical monitor geometry used to place a floating window. */
export interface FloatingMonitorGeometry {
  /** Monitor origin on the compositor X axis. */
  readonly x: number;
  /** Monitor origin on the compositor Y axis. */
  readonly y: number;
  /** Physical monitor width. */
  readonly width: number;
  /** Physical monitor height. */
  readonly height: number;
  /** Output scale. */
  readonly scale: number;
  /** Reserved space at the right edge. */
  readonly reservedRight: number;
  /** Reserved space at the bottom edge. */
  readonly reservedBottom: number;
}

/** Calculated floating window position. */
export interface FloatingPosition {
  /** Window X coordinate. */
  readonly x: number;
  /** Window Y coordinate. */
  readonly y: number;
}

/** Domain error raised by the floating webapp command. */
export class LaunchFloatingWebappError extends Schema.TaggedError<LaunchFloatingWebappError>()(
  "LaunchFloatingWebappError",
  { message: Schema.String, exitCode: Schema.Finite },
) {}

const ClientSchema = Schema.Struct({
  address: Schema.NonEmptyString,
  mapped: Schema.Boolean,
  class: Schema.String,
});
const ClientsSchema = Schema.Array(ClientSchema);
const MonitorSchema = Schema.Struct({
  name: Schema.String,
  focused: Schema.optional(Schema.Boolean),
  x: Schema.optional(Schema.Finite),
  y: Schema.optional(Schema.Finite),
  width: Schema.optional(Schema.Finite),
  height: Schema.optional(Schema.Finite),
  scale: Schema.optional(Schema.Finite),
  reserved: Schema.optional(Schema.Array(Schema.Finite)),
});
const MonitorsSchema = Schema.Array(MonitorSchema);
const WorkspaceSchema = Schema.Struct({
  id: Schema.Finite,
  monitor: Schema.optional(Schema.String),
});
const WorkspacesSchema = Schema.Array(WorkspaceSchema);

type HyprlandClient = Schema.Schema.Type<typeof ClientSchema>;
type HyprlandMonitor = Schema.Schema.Type<typeof MonitorSchema>;

function fail(message: string, exitCode: 1 | 2): never {
  throw new LaunchFloatingWebappError({ message, exitCode });
}

/** Calculate a bottom-right floating position from monitor scale and reserved areas. */
export function calculateFloatingPosition(
  monitor: FloatingMonitorGeometry,
  options: Pick<
    FloatingWebappOptions,
    "width" | "height" | "rightMargin" | "bottomMargin"
  >,
): FloatingPosition {
  const monitorX = Math.floor(monitor.x / monitor.scale);
  const monitorY = Math.floor(monitor.y / monitor.scale);
  const monitorWidth = Math.floor(monitor.width / monitor.scale);
  const monitorHeight = Math.floor(monitor.height / monitor.scale);
  return {
    x:
      monitorX +
      monitorWidth -
      monitor.reservedRight -
      options.width -
      options.rightMargin,
    y:
      monitorY +
      monitorHeight -
      monitor.reservedBottom -
      options.height -
      options.bottomMargin,
  };
}

function parseResponse(source: string, label: string): JsonValue {
  try {
    return decodeJson(JSON.parse(source));
  } catch (error) {
    return fail(
      `launch-floating-webapp: ${label} returned invalid JSON: ${String(error)}`,
      1,
    );
  }
}

function decodeResponse<A, I>(
  schema: Schema.Codec<A, I>,
  source: string,
  label: string,
): A {
  try {
    return Schema.decodeUnknownSync(schema)(parseResponse(source, label));
  } catch (error) {
    if (error instanceof LaunchFloatingWebappError) throw error;
    return fail(
      `launch-floating-webapp: invalid ${label} response: ${String(error)}`,
      1,
    );
  }
}

function webappClassPrefix(url: string): string {
  const withoutScheme = url.includes("://")
    ? url.slice(url.indexOf("://") + 3)
    : url;
  const hostAndPort = withoutScheme.split("/", 1)[0];
  return `chrome-${hostAndPort.split(":", 1)[0]}__`;
}

function webappClassPattern(url: string): string {
  const escapedPrefix = webappClassPrefix(url).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  return `^${escapedPrefix}.*$`;
}

function newWebappAddress(
  clients: readonly HyprlandClient[],
  prefix: string,
  previousAddresses: ReadonlySet<string>,
): string | undefined {
  return clients.find(
    (client) =>
      client.mapped &&
      client.class.startsWith(prefix) &&
      !previousAddresses.has(client.address),
  )?.address;
}

function monitorGeometry(monitor: HyprlandMonitor): FloatingMonitorGeometry {
  const scale = monitor.scale ?? 1;
  if (scale === 0) {
    return fail("launch-floating-webapp: target monitor has invalid scale", 1);
  }
  return {
    x: monitor.x ?? 0,
    y: monitor.y ?? 0,
    width: monitor.width ?? 0,
    height: monitor.height ?? 0,
    scale,
    reservedRight: monitor.reserved?.[2] ?? 0,
    reservedBottom: monitor.reserved?.[3] ?? 0,
  };
}

/** Launch or reposition one webapp and print only its resolved Hyprland address. */
const runLaunchFloatingWebapp = Effect.fn("launchFloatingWebapp")(function* (
  options: FloatingWebappOptions,
) {
  if (options.width <= 0 || options.height <= 0) {
    return fail("launch-floating-webapp: width and height must be positive", 2);
  }
  if (options.rightMargin < 0 || options.bottomMargin < 0) {
    return fail("launch-floating-webapp: margins must be non-negative", 2);
  }
  if (options.address && options.url) {
    return fail(
      "launch-floating-webapp: URL and --address are mutually exclusive",
      2,
    );
  }
  const executor = yield* CommandExecutor;
  let address = options.address;

  if (!address) {
    const url =
      options.url ?? fail("launch-floating-webapp: URL is required", 2);
    const prefix = webappClassPrefix(url);
    const before = decodeResponse(
      ClientsSchema,
      yield* executor.run("hyprctl", ["clients", "-j"]),
      "hyprctl clients",
    );
    const previousAddresses = new Set(
      before
        .filter((client) => client.class.startsWith(prefix))
        .map((client) => client.address),
    );

    yield* executor.run("hyprctl", [
      "eval",
      `launch_floating_webapp_rule = hl.window_rule({ name = "launch-floating-webapp", match = { class = ${JSON.stringify(webappClassPattern(url))} }, float = true })`,
    ]);

    address = yield* Effect.gen(function* () {
      yield* Effect.sync(() => {
        try {
          const proc = Bun.spawn(["omarchy-launch-webapp", url], {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            detached: true,
          });
          proc.unref();
        } catch {
          // Discovery timeout owns launch failure.
        }
      });

      for (let attempt = 0; attempt < DETECT_ATTEMPTS; attempt += 1) {
        const clients = decodeResponse(
          ClientsSchema,
          yield* executor.run("hyprctl", ["clients", "-j"]),
          "hyprctl clients",
        );
        const detected = newWebappAddress(clients, prefix, previousAddresses);
        if (detected) return detected;
        yield* Effect.sleep(DETECT_INTERVAL);
      }
      return fail("launch-floating-webapp: window detection timed out", 1);
    }).pipe(
      Effect.ensuring(
        executor
          .run("hyprctl", [
            "eval",
            "launch_floating_webapp_rule:set_enabled(false)",
          ])
          .pipe(Effect.ignore),
      ),
    );
  }

  const monitors = decodeResponse(
    MonitorsSchema,
    yield* executor.run("hyprctl", ["monitors", "-j"]),
    "hyprctl monitors",
  );
  let monitor: HyprlandMonitor | undefined;
  if (options.monitor) {
    monitor = monitors.find((candidate) => candidate.name === options.monitor);
  } else if (options.workspace) {
    const workspaceId = Number(options.workspace);
    if (!Number.isFinite(workspaceId)) {
      return fail("launch-floating-webapp: target monitor not found", 1);
    }
    const workspaces = decodeResponse(
      WorkspacesSchema,
      yield* executor.run("hyprctl", ["workspaces", "-j"]),
      "hyprctl workspaces",
    );
    const monitorName = workspaces.find(
      (workspace) => workspace.id === workspaceId,
    )?.monitor;
    monitor = monitors.find((candidate) => candidate.name === monitorName);
  } else {
    monitor = monitors.find((candidate) => candidate.focused === true);
  }
  if (!monitor) {
    return fail("launch-floating-webapp: target monitor not found", 1);
  }

  const position = calculateFloatingPosition(monitorGeometry(monitor), options);
  const dispatches: string[] = [];
  if (options.workspace) {
    dispatches.push(
      `hl.dsp.window.move({ workspace = '${options.workspace}', window = 'address:${address}', follow = false })`,
    );
  }
  dispatches.push(
    `hl.dsp.window.float({ action = 'enable', window = 'address:${address}' })`,
    `hl.dsp.window.resize({ x = ${options.width}, y = ${options.height}, window = 'address:${address}' })`,
    `hl.dsp.window.move({ x = ${position.x}, y = ${position.y}, window = 'address:${address}' })`,
  );
  yield* executor.run("hyprctl", [
    "--batch",
    dispatches.map((dispatch) => `dispatch ${dispatch}`).join(" ; "),
  ]);
  yield* Effect.sync(() => process.stdout.write(`${address}\n`));
});

/** Launch or reposition one webapp, preserving the command's public error contract. */
export const launchFloatingWebapp = (options: FloatingWebappOptions) =>
  runLaunchFloatingWebapp(options).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      if (!(error instanceof LaunchFloatingWebappError)) {
        return Effect.failCause(cause);
      }
      return Effect.sync(() => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = error.exitCode;
      });
    }),
  );
