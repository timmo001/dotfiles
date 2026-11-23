import { Effect, Option, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** The headless Hyprland output agents record on. Its mode and position come from hypr/monitors.lua. */
const OUTPUT = "AGENT";

/** The agent screen can't do what was asked. */
export class AgentScreenError extends Schema.TaggedError<AgentScreenError>()(
  "AgentScreenError",
  { message: Schema.String },
) {}

const MonitorSchema = Schema.Struct({
  id: Schema.Finite,
  name: Schema.String,
  width: Schema.Finite,
  height: Schema.Finite,
  scale: Schema.Finite,
  activeWorkspace: Schema.Struct({ id: Schema.Finite }),
});

const ClientSchema = Schema.Struct({
  address: Schema.String,
  title: Schema.String,
  monitor: Schema.Finite,
});

const decodeMonitors = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(MonitorSchema)),
);

const decodeClients = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(ClientSchema)),
);

const say = (line: string) =>
  Effect.sync(() => process.stdout.write(`${line}\n`));

/** The agent screen's output, when it's on. */
const agentOutput = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const monitors = yield* executor
    .run("hyprctl", ["-j", "monitors"])
    .pipe(Effect.flatMap(decodeMonitors));

  return Option.fromNullishOr(
    monitors.find((monitor) => monitor.name === OUTPUT),
  );
}).pipe(Effect.withSpan("AgentScreen.output"));

/** The windows on the agent screen. */
const windowsOn = Effect.fn("AgentScreen.windowsOn")(function* (
  monitorId: number,
) {
  const executor = yield* CommandExecutor;

  const clients = yield* executor
    .run("hyprctl", ["-j", "clients"])
    .pipe(Effect.flatMap(decodeClients));

  return clients.filter((client) => client.monitor === monitorId);
});

/** One line saying where the agent screen is and what's on it. */
const describeOutput = Effect.fn("AgentScreen.describe")(function* (
  output: typeof MonitorSchema.Type,
) {
  const windows = yield* windowsOn(output.id);

  const count = windows.length === 1 ? "1 window" : `${windows.length} windows`;

  return `${OUTPUT} is on: workspace ${output.activeWorkspace.id}, ${output.width}x${output.height} at scale ${output.scale}, ${count}.`;
});

/** Add the agent screen, a headless output no real monitor shows. */
export const agentScreenOn = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  if (Option.isNone(yield* agentOutput))
    yield* executor.run("hyprctl", ["output", "create", "headless", OUTPUT]);

  const output = yield* agentOutput;

  if (Option.isNone(output))
    return yield* new AgentScreenError({
      message: `Hyprland didn't add ${OUTPUT}.`,
    });

  yield* say(yield* describeOutput(output.value));
}).pipe(Effect.withSpan("AgentScreen.on"));

/** Remove the agent screen, once nothing is left on it. */
export const agentScreenOff = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const output = yield* agentOutput;

  if (Option.isNone(output)) {
    yield* say(`${OUTPUT} is already off.`);

    return;
  }

  // Omarchy moves a removed output's workspaces, windows and all, onto a
  // real monitor, so windows left here would land on the user's screen
  const windows = yield* windowsOn(output.value.id);

  if (windows.length > 0)
    return yield* new AgentScreenError({
      message: `Close what's on ${OUTPUT} first, or it moves onto a real monitor: ${windows
        .map((window) => `${window.title} (${window.address})`)
        .join(", ")}`,
    });

  // A mirror of an output that's gone has nothing left to show
  yield* stopMirror;
  yield* executor.run("hyprctl", ["output", "remove", OUTPUT]);
  yield* say(`${OUTPUT} is off.`);
}).pipe(Effect.withSpan("AgentScreen.off"));

/** How the agent screen can be shown, in the order the keybind steps through them. */
export const VIEW_MODES = ["overlay", "fullscreen", "tile", "hidden"] as const;

/** One of the ways to show the agent screen. */
export type ViewMode = (typeof VIEW_MODES)[number];

/** The Omarchy shell plugin that draws the overlay and full screen views. */
const SHELL_TARGET = "timmo.agent-screen";

/** The user unit running the tiled wl-mirror window, so it can be closed again. */
const MIRROR_UNIT = "agent-screen-mirror.service";

const VIEW_MESSAGES: Record<ViewMode, string> = {
  overlay: `Showing ${OUTPUT} as a translucent corner view that clicks pass through.`,
  fullscreen: `Showing ${OUTPUT} full screen. Escape or a click goes back to the corner view.`,
  tile: `Showing ${OUTPUT} in a tiled wl-mirror window.`,
  hidden: `Hiding ${OUTPUT}. It shows in the corner again next time it's turned on.`,
};

const ShellState = Schema.Struct({ on: Schema.Boolean, mode: Schema.String });

const decodeShellState = Schema.decodeEffect(Schema.fromJsonString(ShellState));

const isViewMode = (value: string): value is ViewMode =>
  VIEW_MODES.some((mode) => mode === value);

/** Show a desktop notification. */
const notify = Effect.fn("AgentScreen.notify")(function* (
  title: string,
  body: string,
) {
  const executor = yield* CommandExecutor;

  yield* executor.exitCode("omarchy", [
    "notification",
    "send",
    "-g",
    "󰍹",
    "--app-name",
    "Display",
    title,
    body,
  ]);
});

const mirrorRunning = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  return (
    (yield* executor.exitCode("systemctl", [
      "--user",
      "--quiet",
      "is-active",
      MIRROR_UNIT,
    ])) === 0
  );
}).pipe(Effect.withSpan("AgentScreen.mirrorRunning"));

/** How the agent screen shows now: the mirror window, or the shell's view. */
const currentMode = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  if (yield* mirrorRunning) return "tile" as const;

  const mode = yield* executor
    .run("omarchy-shell", [SHELL_TARGET, "state"])
    .pipe(
      Effect.flatMap(decodeShellState),
      Effect.map((state) => state.mode),
      // Without the plugin, treat it as hidden, so the keybind starts at overlay
      Effect.orElseSucceed(() => "hidden"),
    );

  return isViewMode(mode) ? mode : "hidden";
}).pipe(Effect.withSpan("AgentScreen.currentMode"));

const nextMode = (mode: ViewMode): ViewMode =>
  VIEW_MODES[(VIEW_MODES.indexOf(mode) + 1) % VIEW_MODES.length] ?? "overlay";

const stopMirror = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  if (yield* mirrorRunning)
    yield* executor.run("systemctl", ["--user", "stop", MIRROR_UNIT]);
}).pipe(Effect.withSpan("AgentScreen.stopMirror"));

const applyMode = Effect.fn("AgentScreen.applyMode")(function* (
  mode: ViewMode,
) {
  const executor = yield* CommandExecutor;

  if (mode !== "tile") {
    yield* stopMirror;
    yield* executor.run("omarchy-shell", [SHELL_TARGET, "show", mode]);

    return;
  }

  yield* executor.run("omarchy-shell", [SHELL_TARGET, "show", "hidden"]);

  // As a service, so this returns while the window stays open
  if (!(yield* mirrorRunning))
    yield* executor.run("uwsm-app", [
      "-t",
      "service",
      "-u",
      MIRROR_UNIT,
      "--",
      "wl-mirror",
      OUTPUT,
    ]);
});

/**
 * Show the agent screen as a translucent corner view, full screen, a tiled
 * wl-mirror window, or not at all. Without a mode, step to the next one.
 */
export const agentScreenView = Effect.fn("AgentScreen.view")(function* (
  requested: ViewMode | undefined,
) {
  if (Option.isNone(yield* agentOutput)) {
    // The keybind has no terminal, so say it where it can be seen
    yield* notify(
      "Agent screen",
      `${OUTPUT} is off, so there's nothing to show.`,
    );

    return yield* new AgentScreenError({
      message: `${OUTPUT} is off. Turn it on with dot agent screen on.`,
    });
  }

  const mode = requested ?? nextMode(yield* currentMode);

  yield* applyMode(mode);
  yield* say(VIEW_MESSAGES[mode]);
});

/** Say whether the agent screen is on, and where. */
export const agentScreenStatus = Effect.gen(function* () {
  const output = yield* agentOutput;

  yield* say(
    Option.isSome(output)
      ? yield* describeOutput(output.value)
      : `${OUTPUT} is off.`,
  );
}).pipe(Effect.withSpan("AgentScreen.status"));
