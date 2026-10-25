import { join } from "node:path";
import { Effect, FileSystem, Schema } from "effect";
import { ENV, envString } from "../lib/env.js";
import { currentOmarchyHost } from "../lib/omarchyHost.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** HDR could not be switched on the primary monitor. */
export class HdrError extends Schema.TaggedError<HdrError>()("HdrError", {
  message: Schema.String,
}) {}

/** Primary monitor on the desktop, whatever has focus. */
const DESKTOP_MONITOR = "HDMI-A-2";

/** AORUS FO32U2P in its Peak 1000 HDR mode; the EDID only reports the True Black 400 peak. */
const DESKTOP_LUMINANCE =
  ", min_luminance = 0, max_luminance = 1000, max_avg_luminance = 277";

const MonitorSchema = Schema.Struct({
  name: Schema.String,
  focused: Schema.Boolean,
  width: Schema.Finite,
  height: Schema.Finite,
  refreshRate: Schema.Finite,
  x: Schema.Finite,
  y: Schema.Finite,
  scale: Schema.Finite,
  transform: Schema.Finite,
  currentFormat: Schema.String,
  colorManagementPreset: Schema.optional(Schema.String),
  sdrBrightness: Schema.optional(Schema.Finite),
});

type Monitor = typeof MonitorSchema.Type;

const decodeMonitors = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(MonitorSchema)),
);

/**
 * Read by monitors.lua so a Hyprland reload (such as from dot stow) keeps HDR
 * on. Lives in the runtime dir so it ends with the session.
 */
function stateFile(): string {
  const runtimeDir =
    envString(ENV.XDG_RUNTIME_DIR) ?? `/run/user/${process.getuid?.() ?? 1000}`;

  return join(runtimeDir, "hypr-hdr-monitor.lua");
}

function isHdr(monitor: Monitor): boolean {
  return (
    monitor.colorManagementPreset === "hdr" ||
    (monitor.currentFormat === "XRGB2101010" && monitor.sdrBrightness === 2)
  );
}

function monitorSpec(monitor: Monitor): string {
  const spec = `output = "${monitor.name}", mode = "${monitor.width}x${monitor.height}@${monitor.refreshRate.toFixed(2)}Hz", position = "${monitor.x}x${monitor.y}", scale = ${monitor.scale}`;

  return monitor.transform === 0
    ? spec
    : `${spec}, transform = ${monitor.transform}`;
}

/** Switch the primary monitor's HDR on or off, leaving it alone when it is already there. */
export const hdr = Effect.fn("hdr")(function* (state: "on" | "off") {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;

  const notify = (title: string, message: string, critical = false) =>
    executor
      .exitCode("omarchy", [
        "notification",
        "send",
        "-g",
        "󰍹",
        ...(critical ? ["-u", "critical"] : []),
        "--app-name",
        "Display",
        title,
        message,
      ])
      .pipe(Effect.asVoid);

  const switchHdr = Effect.gen(function* () {
    const monitors = yield* executor.run("hyprctl", ["-j", "monitors"]).pipe(
      Effect.flatMap(decodeMonitors),
      Effect.mapError(
        () =>
          new HdrError({ message: "Could not read Hyprland monitor state." }),
      ),
    );

    const desktop = currentOmarchyHost() === "desktop";

    const monitor = desktop
      ? monitors.find((candidate) => candidate.name === DESKTOP_MONITOR)
      : monitors.find((candidate) => candidate.focused);

    if (!monitor)
      return yield* new HdrError({
        message: "The primary monitor is not connected.",
      });

    const file = stateFile();

    if (state === "off") {
      yield* fs.remove(file, { force: true });

      if (!isHdr(monitor)) {
        yield* Effect.sync(() =>
          process.stdout.write(`HDR is already disabled on ${monitor.name}.\n`),
        );

        return;
      }

      yield* executor.run("hyprctl", [
        "eval",
        `hl.monitor({ ${monitorSpec(monitor)}, bitdepth = 8, cm = "srgb", sdrbrightness = 1.0 })`,
      ]);
      yield* notify(
        "HDR disabled",
        `Restored SDR colour and brightness for ${monitor.name}.`,
      );

      return;
    }

    const hdrMonitor = `hl.monitor({ ${monitorSpec(monitor)}, bitdepth = 10, cm = "hdr", sdrbrightness = 2.0${desktop ? DESKTOP_LUMINANCE : ""} })`;

    yield* fs.writeFileString(`${file}.tmp`, `${hdrMonitor}\n`);
    yield* fs.rename(`${file}.tmp`, file);

    if (isHdr(monitor)) {
      yield* Effect.sync(() =>
        process.stdout.write(`HDR is already enabled on ${monitor.name}.\n`),
      );

      return;
    }

    yield* executor.run("hyprctl", ["eval", hdrMonitor]);
    yield* notify(
      "HDR enabled",
      `${monitor.name} is using 10-bit HDR with the full BT.2020 colour gamut.`,
    );
  });

  yield* switchHdr.pipe(
    Effect.catchTag("HdrError", (error) =>
      notify("HDR failed", error.message, true).pipe(
        Effect.andThen(
          Effect.sync(() => {
            process.stderr.write(`[ERROR] ${error.message}\n`);
            process.exitCode = 1;
          }),
        ),
      ),
    ),
  );
});
