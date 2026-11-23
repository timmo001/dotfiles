import { join } from "node:path";
import { Duration, Effect, FileSystem, Option, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";

/**
 * The headless Hyprland output that holds new agent windows. Every desk is a
 * headless output of its own, AGENT-1 and up, so each session shows on its
 * own. Their modes, positions and workspaces come from hypr/monitors.lua, and
 * a window rule there sends each new browse window to this one's workspace.
 */
const HOLD = "AGENT";

/** As many desks as hypr/monitors.lua sets up. */
const MAX_DESKS = 6;

const deskOutput = (desk: number) => `${HOLD}-${desk}`;

const deskWorkspace = (desk: number) => `name:agent-${desk}`;

const isAgentOutput = (name: string) =>
  name === HOLD || /^AGENT-\d+$/.test(name);

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
  workspace: Schema.Struct({ id: Schema.Finite, name: Schema.String }),
});

type Monitor = typeof MonitorSchema.Type;

type Client = typeof ClientSchema.Type;

/** Who holds each desk, by output name, and the windows they moved there. */
const DesksSchema = Schema.Record(
  Schema.String,
  Schema.Struct({
    session: Schema.String,
    windows: Schema.Array(Schema.String),
  }),
);

type Desks = typeof DesksSchema.Type;

const decodeMonitors = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(MonitorSchema)),
);

const decodeClients = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(ClientSchema)),
);

const decodeDesks = Schema.decodeEffect(Schema.fromJsonString(DesksSchema));

const say = (line: string) =>
  Effect.sync(() => process.stdout.write(`${line}\n`));

const fail = (message: string) => new AgentScreenError({ message });

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** Where the desks' owners are kept until the next login. */
const desksFile = () =>
  join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "dot-agent-desks.json");

const monitors = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  return yield* executor
    .run("hyprctl", ["-j", "monitors"])
    .pipe(Effect.flatMap(decodeMonitors));
}).pipe(Effect.withSpan("AgentScreen.monitors"));

const clients = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  return yield* executor
    .run("hyprctl", ["-j", "clients"])
    .pipe(Effect.flatMap(decodeClients));
}).pipe(Effect.withSpan("AgentScreen.clients"));

/** The agent outputs that are on, the holding one first. */
const agentOutputs = Effect.gen(function* () {
  return (yield* monitors)
    .filter((monitor) => isAgentOutput(monitor.name))
    .toSorted((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}).pipe(Effect.withSpan("AgentScreen.outputs"));

const findOutput = Effect.fn("AgentScreen.findOutput")(function* (
  name: string,
) {
  return Option.fromNullishOr(
    (yield* monitors).find((monitor) => monitor.name === name),
  );
});

/** Who holds which desk, leaving out desks and windows that are gone. */
const readDesks = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const stored = yield* fs.readFileString(desksFile()).pipe(
    Effect.flatMap(decodeDesks),
    Effect.orElseSucceed((): Desks => ({})),
  );

  const outputs = new Set((yield* agentOutputs).map((output) => output.name));
  const open = new Set((yield* clients).map((client) => client.address));

  const desks: Record<string, Desks[string]> = {};

  for (const [output, desk] of Object.entries(stored)) {
    if (!outputs.has(output)) continue;

    desks[output] = {
      session: desk.session,
      windows: desk.windows.filter((address) => open.has(address)),
    };
  }

  return desks;
}).pipe(Effect.withSpan("AgentScreen.readDesks"));

const writeDesks = Effect.fn("AgentScreen.writeDesks")(function* (
  desks: Desks,
) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.writeFileString(desksFile(), JSON.stringify(desks, null, 2));
});

/** The session a claim or release is for. */
const sessionLabel = (session: string | undefined) =>
  session ?? process.env.OPENCODE_SESSION_ID ?? "unnamed session";

const dispatch = Effect.fn("AgentScreen.dispatch")(function* (lua: string) {
  const executor = yield* CommandExecutor;

  const reply = (yield* executor.run("hyprctl", ["dispatch", lua])).trim();

  if (reply !== "ok") return yield* fail(`Hyprland refused ${lua}: ${reply}`);
});

/** Add a headless output and wait for Hyprland to report it. */
const addOutput = Effect.fn("AgentScreen.addOutput")(function* (name: string) {
  const executor = yield* CommandExecutor;

  if (Option.isSome(yield* findOutput(name))) return;

  yield* executor.run("hyprctl", ["output", "create", "headless", name]);

  for (let attempt = 0; attempt < 20; attempt++) {
    if (Option.isSome(yield* findOutput(name))) return;

    yield* Effect.sleep(Duration.millis(100));
  }

  return yield* fail(`Hyprland didn't add ${name}.`);
});

/** One line saying what an agent output shows. */
const describeOutput = (
  output: Monitor,
  windows: readonly Client[],
  desks: Desks,
) => {
  const onIt = windows.filter((window) => window.monitor === output.id);
  const titles = onIt.map((window) => window.title).join(", ");

  const contents = onIt.length
    ? `${plural(onIt.length, "window")}: ${titles}`
    : "empty";

  if (output.name === HOLD)
    return `${HOLD} holds new agent windows, ${contents}.`;

  const owner = desks[output.name]?.session ?? "nobody";

  return `${output.name} is ${owner}'s desk, ${contents}.`;
};

/**
 * Add the holding screen, so new agent windows land off-screen, and show the
 * corner overlay, whatever view an earlier session left behind.
 */
export const agentScreenOn = Effect.gen(function* () {
  yield* addOutput(HOLD);

  const output = yield* findOutput(HOLD);

  if (Option.isNone(output)) return yield* fail(`Hyprland didn't add ${HOLD}.`);

  // The shell only resets its view once every agent screen is gone, so a
  // view hidden while AGENT stayed on would otherwise stick for this session
  const overlay = yield* applyMode("overlay").pipe(
    Effect.as("The corner overlay shows them."),
    Effect.catch((error) =>
      Effect.succeed(`The corner overlay couldn't be shown: ${error.message}`),
    ),
  );

  yield* say(
    `${HOLD} is on: ${output.value.width}x${output.value.height} at scale ${output.value.scale}. New browse windows land there until a session claims a desk. ${overlay}`,
  );
}).pipe(Effect.withSpan("AgentScreen.on"));

/**
 * Give a session a desk of its own and move its newest browse window there.
 * Run it straight after opening the session's first tab.
 */
export const agentScreenClaim = Effect.fn("AgentScreen.claim")(function* (
  session: string | undefined,
) {
  const label = sessionLabel(session);

  yield* addOutput(HOLD);

  let desks = yield* readDesks;
  const claimed = new Set(Object.values(desks).flatMap((desk) => desk.windows));

  // The window rule holds new browse windows on the agent workspace; give a
  // window that has only just opened a moment to arrive
  let waiting: Client | undefined;

  for (let attempt = 0; attempt < 20 && !waiting; attempt++) {
    waiting = (yield* clients)
      .filter(
        (client) =>
          client.workspace.name === "agent" && !claimed.has(client.address),
      )
      .at(-1);

    if (!waiting) yield* Effect.sleep(Duration.millis(250));
  }

  const held = Object.entries(desks).find(([, desk]) => desk.session === label);

  if (!waiting) {
    if (held) {
      yield* say(
        `${label} already has ${held[0]}, and no new window is waiting.`,
      );

      return;
    }

    // browse opens every session's tabs in one shared window, so a later
    // session's tabs land in the window an earlier one already claimed
    const shared = Object.entries(desks).find(
      ([, desk]) => desk.windows.length > 0,
    );

    if (shared) {
      yield* say(
        `${label}'s tabs share ${shared[0]} with ${shared[1].session}, since browse puts every session's tabs in one window. Work there, and leave the other session's tabs alone.`,
      );

      return;
    }

    return yield* fail(
      `No new browse window is waiting on ${HOLD}. Open the session's first tab, then claim.`,
    );
  }

  const free = Array.from({ length: MAX_DESKS }, (_, index) => index + 1).find(
    (desk) => !desks[deskOutput(desk)],
  );

  const desk = held ? Number(held[0].slice(HOLD.length + 1)) : free;

  if (desk === undefined)
    return yield* fail(
      `All ${MAX_DESKS} desks are taken. Release one with dot agent screen release.`,
    );

  yield* addOutput(deskOutput(desk));
  yield* dispatch(
    `hl.dsp.window.move({ workspace = "${deskWorkspace(desk)}", follow = false, window = "address:${waiting.address}" })`,
  );

  desks = {
    ...desks,
    [deskOutput(desk)]: {
      session: label,
      windows: [...(desks[deskOutput(desk)]?.windows ?? []), waiting.address],
    },
  };

  yield* writeDesks(desks);
  yield* say(
    `${deskOutput(desk)} is ${label}'s desk, showing ${waiting.title}.`,
  );
});

/** Free a session's desk once its windows are closed, and remove its output. */
export const agentScreenRelease = Effect.fn("AgentScreen.release")(function* (
  session: string | undefined,
) {
  const executor = yield* CommandExecutor;
  const label = sessionLabel(session);
  const desks = yield* readDesks;
  const held = Object.entries(desks).find(([, desk]) => desk.session === label);

  if (!held) {
    yield* say(`${label} has no desk.`);

    return;
  }

  const [name] = held;
  const output = yield* findOutput(name);

  if (Option.isSome(output)) {
    const left = (yield* clients).filter(
      (client) => client.monitor === output.value.id,
    );

    // A removed output's windows would move onto a real monitor
    if (left.length > 0)
      return yield* fail(
        `Close ${label}'s tabs first, or they move onto a real monitor: ${left
          .map((window) => `${window.title} (${window.address})`)
          .join(", ")}`,
      );

    yield* stopMirror(name);
    yield* executor.run("hyprctl", ["output", "remove", name]);
  }

  const { [name]: _released, ...rest } = desks;

  yield* writeDesks(rest);
  yield* say(`Released ${name} from ${label}.`);
});

/** Remove the holding screen and every desk, once nothing is left on them. */
export const agentScreenOff = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const outputs = yield* agentOutputs;

  if (outputs.length === 0) {
    yield* say(`${HOLD} is already off.`);

    return;
  }

  // Omarchy moves a removed output's workspaces, windows and all, onto a
  // real monitor, so windows left here would land on the user's screen
  const ids = new Set(outputs.map((output) => output.id));
  const left = (yield* clients).filter((client) => ids.has(client.monitor));

  if (left.length > 0)
    return yield* fail(
      `Close what's on the agent screens first, or it moves onto a real monitor: ${left
        .map((window) => `${window.title} (${window.address})`)
        .join(", ")}`,
    );

  yield* stopMirror(undefined);

  // Desks first, so the holding screen goes last
  for (const output of outputs.toReversed())
    yield* executor.run("hyprctl", ["output", "remove", output.name]);

  yield* writeDesks({});
  yield* say(`${HOLD} and its desks are off.`);
}).pipe(Effect.withSpan("AgentScreen.off"));

/** How the agent screens can be shown, in the order the keybind steps through them. */
export const VIEW_MODES = ["overlay", "tile", "fullscreen", "hidden"] as const;

/** One of the ways to show the agent screens. */
export type ViewMode = (typeof VIEW_MODES)[number];

/** The Omarchy shell plugin that draws the overlay and full screen views. */
const SHELL_TARGET = "timmo.agent-screen";

/** The user units running a tiled wl-mirror window per agent output. */
const MIRROR_PREFIX = "agent-screen-mirror-";

const mirrorUnit = (output: string) =>
  `${MIRROR_PREFIX}${output.toLowerCase()}.service`;

const VIEW_MESSAGES: Record<ViewMode, string> = {
  overlay:
    "Showing each agent screen with windows as a translucent corner view that clicks pass through.",
  tile: "Showing each agent screen with windows in a tiled wl-mirror window.",
  fullscreen:
    "Showing the agent screens full screen. Escape or a click goes back to the corner views.",
  hidden:
    "Hiding the agent screens. They show in the corner again next time they're turned on.",
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

/** The mirror units that are running. */
const runningMirrors = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const listed = yield* executor
    .run("systemctl", [
      "--user",
      "list-units",
      "--plain",
      "--no-legend",
      "--state=active",
      `${MIRROR_PREFIX}*`,
    ])
    .pipe(Effect.orElseSucceed(() => ""));

  return listed
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((unit) => unit.startsWith(MIRROR_PREFIX));
}).pipe(Effect.withSpan("AgentScreen.runningMirrors"));

/** Stop one output's mirror, or every mirror. */
const stopMirror = Effect.fn("AgentScreen.stopMirror")(function* (
  output: string | undefined,
) {
  const executor = yield* CommandExecutor;
  const running = yield* runningMirrors;

  const units = output
    ? running.filter((unit) => unit === mirrorUnit(output))
    : running;

  if (units.length > 0)
    yield* executor.run("systemctl", ["--user", "stop", ...units]);
});

/** How the agent screens show now: mirror windows, or the shell's view. */
const currentMode = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  if ((yield* runningMirrors).length > 0) return "tile" as const;

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

const applyMode = Effect.fn("AgentScreen.applyMode")(function* (
  mode: ViewMode,
) {
  const executor = yield* CommandExecutor;

  if (mode !== "tile") {
    yield* stopMirror(undefined);
    yield* executor.run("omarchy-shell", [SHELL_TARGET, "show", mode]);

    return;
  }

  yield* executor.run("omarchy-shell", [SHELL_TARGET, "show", "hidden"]);

  const windows = yield* clients;
  const running = yield* runningMirrors;

  // One window per screen with something on it, as services, so this
  // returns while they stay open
  for (const output of yield* agentOutputs) {
    if (!windows.some((window) => window.monitor === output.id)) continue;

    if (running.includes(mirrorUnit(output.name))) continue;

    yield* executor.run("uwsm-app", [
      "-t",
      "service",
      "-u",
      mirrorUnit(output.name),
      "--",
      "wl-mirror",
      output.name,
    ]);
  }
});

/**
 * Show the agent screens as translucent corner views, tiled wl-mirror
 * windows, full screen, or not at all. Without a mode, step to the next one.
 */
export const agentScreenView = Effect.fn("AgentScreen.view")(function* (
  requested: ViewMode | undefined,
) {
  if ((yield* agentOutputs).length === 0) {
    // The keybind has no terminal, so say it where it can be seen
    yield* notify(
      "Agent screen",
      `${HOLD} is off, so there's nothing to show.`,
    );

    return yield* fail(`${HOLD} is off. Turn it on with dot agent screen on.`);
  }

  const mode = requested ?? nextMode(yield* currentMode);

  yield* applyMode(mode);
  yield* say(VIEW_MESSAGES[mode]);
});

/** Say which agent screens are on, who holds each desk, and what's on them. */
export const agentScreenStatus = Effect.gen(function* () {
  const outputs = yield* agentOutputs;

  if (outputs.length === 0) {
    yield* say(`${HOLD} is off.`);

    return;
  }

  const windows = yield* clients;
  const desks = yield* readDesks;

  for (const output of outputs)
    yield* say(describeOutput(output, windows, desks));
}).pipe(Effect.withSpan("AgentScreen.status"));
